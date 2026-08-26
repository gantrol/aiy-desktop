import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  ArticleContentInput,
  ArticleDto,
  DerivedVisualAdoptInput,
  DerivedVisualAdoptResult,
  DerivedVisualDto,
  DerivedVisualWorkspaceCreateInput,
  DerivedVisualWorkspaceOpenInput,
  DerivedVisualWorkspaceOpenResult,
  SocialPostContentInput,
  SocialPostDto,
} from '@/shared/contracts';
import { articleInlineVisualAnchorSchema, derivedVisualRoleSchema } from '@/shared/contracts/derived-visual';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import type { IntakeRepository } from '@/main/database/creations/intake-repository';
import type { SocialPostRepository } from '@/main/database/creations/social-post-repository';
import type { CreationItemRepository } from '@/main/database/creations/creation-item-repository';

const allowedCanvasPresets = {
  ARTICLE_HEADER: new Set(['wechat_article_cover_2_35_1']),
  ARTICLE_INLINE: new Set(['landscape_4_3', 'square_1_1', 'xiaohongshu_portrait_3_4', 'video_landscape_16_9']),
  SOCIAL_POST_COVER: new Set(['xiaohongshu_portrait_3_4', 'social_portrait_4_5', 'square_1_1']),
} as const;

function imageExtension(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'jpg';
}

function articleContent(article: ArticleDto): ArticleContentInput {
  const { mediaAssets: _mediaAssets, ...content } = article.content;
  return { ...content, mediaBindings: content.mediaBindings.map((binding) => ({ ...binding })) };
}

function socialPostContent(post: SocialPostDto): SocialPostContentInput {
  const { mediaAssets: _mediaAssets, ...content } = post.content;
  return { ...content, mediaAssetIds: [...content.mediaAssetIds] };
}

function derivedPath(visualId: string, mimeType: string) {
  return `assets/visual-${visualId}.${imageExtension(mimeType)}`;
}

function roleLabel(
  role: DerivedVisualWorkspaceCreateInput['role'],
  locale: DerivedVisualWorkspaceCreateInput['locale'],
) {
  if (locale === 'zh') {
    if (role === 'ARTICLE_HEADER') return '题图';
    if (role === 'ARTICLE_INLINE') return '配图';
    return '封面';
  }
  if (role === 'ARTICLE_HEADER') return 'Hero image';
  if (role === 'ARTICLE_INLINE') return 'Illustration';
  return 'Cover';
}

interface DerivedVisualWorkspaceTarget {
  article: ArticleDto | null;
  socialPost: SocialPostDto | null;
}

function creationFormAnchorKey(input: DerivedVisualWorkspaceCreateInput) {
  if (input.role !== 'ARTICLE_INLINE') return null;
  return createHash('sha256').update(input.articleId).update('\0').update(input.anchor.selectedText).digest('hex');
}

export class DerivedVisualRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly intake: IntakeRepository,
    private readonly articles: ArticleRepository,
    private readonly socialPosts: SocialPostRepository,
    private readonly creationItems: CreationItemRepository,
  ) {}

  private get db() {
    return this.storage.db;
  }

  list(): DerivedVisualDto[] {
    return (this.db.prepare('SELECT * FROM derived_visuals ORDER BY created_at DESC, id DESC').all() as JsonMap[]).map(
      (row) => this.dto(row),
    );
  }

  openWorkspace(input: DerivedVisualWorkspaceOpenInput): DerivedVisualWorkspaceOpenResult {
    if (input.mode === 'RESUME') return this.resumeWorkspace(input.visualId);
    if (!allowedCanvasPresets[input.role].has(input.canvasPresetKey)) {
      throw new Error('This canvas is unavailable for the requested visual');
    }
    return this.db
      .transaction((): DerivedVisualWorkspaceOpenResult => {
        const target = this.resolveWorkspaceTarget(input);
        const parentEntity = target.article
          ? ({ kind: 'ARTICLE', id: target.article.id } as const)
          : ({ kind: 'SOCIAL_POST', id: target.socialPost!.id } as const);
        const item = this.creationItems.findForEntity(parentEntity);
        if (!item) throw new Error('The source creation item is unavailable');

        const role = input.role;
        const anchorKey = creationFormAnchorKey(input);
        const existing = this.creationItems.findForm(item.id, role, anchorKey);
        if (existing) {
          if (existing.entity.kind !== 'DERIVED_VISUAL') {
            throw new Error('The existing creation form has an invalid entity');
          }
          return this.resumeWorkspace(existing.entity.id);
        }

        const workspace = this.createWorkspace(input, target);
        const entity = { kind: 'DERIVED_VISUAL' as const, id: workspace.visual.id };
        if (role === 'ARTICLE_INLINE') {
          if (!anchorKey) throw new Error('An article illustration form requires an anchor');
          this.creationItems.addOrGetForm({
            creationItemId: item.id,
            role,
            entity,
            anchorKey,
          });
        } else {
          this.creationItems.addOrGetForm({
            creationItemId: item.id,
            role,
            entity,
            anchorKey: null,
          });
        }
        return workspace;
      })
      .immediate();
  }

  private resumeWorkspace(visualId: string): DerivedVisualWorkspaceOpenResult {
    const visual = this.get(visualId);
    if (visual.promptSeriesId) {
      const series = this.db
        .prepare('SELECT 1 FROM prompt_series WHERE id = ? AND deleted_at IS NULL')
        .get(visual.promptSeriesId);
      if (!series) throw new Error('The derived visual workspace is unavailable');
      return { kind: 'SERIES', reused: true, seriesId: visual.promptSeriesId, visual };
    }
    return { kind: 'DRAFT', reused: true, draft: this.intake.getDraft(visual.creationDraftId), visual };
  }

  private resolveWorkspaceTarget(input: DerivedVisualWorkspaceCreateInput): DerivedVisualWorkspaceTarget {
    if (input.role === 'SOCIAL_POST_COVER') {
      const socialPost = this.socialPosts.get(input.socialPostId);
      if (socialPost.status !== 'ACTIVE' || socialPost.revisionId !== input.socialPostRevisionId) {
        throw new Error('The social post changed before cover generation started');
      }
      return { article: null, socialPost };
    }
    const article = this.articles.get(input.articleId);
    if (article.status !== 'ACTIVE' || article.revisionId !== input.articleRevisionId) {
      throw new Error('The article changed before visual generation started');
    }
    return { article, socialPost: null };
  }

  private saveWorkspaceDraft(
    input: DerivedVisualWorkspaceCreateInput,
    target: DerivedVisualWorkspaceTarget,
    id: string | null,
  ) {
    const sourceTitle =
      target.article?.content.title ||
      target.socialPost?.content.title ||
      (input.locale === 'zh' ? '未命名' : 'Untitled');
    return this.intake.saveDraft({
      id,
      targetAlbumId: target.article?.albumId ?? target.socialPost?.albumId ?? null,
      title: `${sourceTitle} · ${roleLabel(input.role, input.locale)}`.slice(0, 300),
      text: input.prompt,
      promptNodes: [{ kind: 'TEXT', text: input.prompt }],
      referenceAssetIds: [],
      termPromptLocale: input.locale,
      termIds: [],
      wordPaletteReferences: [],
      dictionaryScope: emptyCreationDictionaryScope(),
      canvasPresetKey: input.canvasPresetKey,
      quality: 'low',
      selectedModelKeys: [],
      repeatCount: 1,
      modelTargets: [],
    });
  }

  private createWorkspace(
    input: DerivedVisualWorkspaceCreateInput,
    target: DerivedVisualWorkspaceTarget,
  ): DerivedVisualWorkspaceOpenResult {
    const draft = this.saveWorkspaceDraft(input, target, null);
    const id = ulid();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO derived_visuals
          (id, role, article_id, article_revision_id, social_post_id, social_post_revision_id,
            anchor_json, creation_draft_id, prompt_series_id, selected_image_asset_id,
            created_at, updated_at, adopted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        input.role,
        target.article?.id ?? null,
        target.article?.revisionId ?? null,
        target.socialPost?.id ?? null,
        target.socialPost?.revisionId ?? null,
        JSON.stringify(input.role === 'ARTICLE_INLINE' ? input.anchor : null),
        draft.id,
        timestamp,
        timestamp,
      );
    this.storage.recordChange('DERIVED_VISUAL', id, 'CREATE', {
      role: input.role,
      articleId: target.article?.id ?? null,
      socialPostId: target.socialPost?.id ?? null,
      creationDraftId: draft.id,
    });
    return { kind: 'DRAFT', reused: false, draft, visual: this.get(id) };
  }

  adopt(input: DerivedVisualAdoptInput): DerivedVisualAdoptResult {
    return this.db
      .transaction(() => {
        const visual = this.get(input.id);
        if (!visual.promptSeriesId) throw new Error('Generate this visual before adopting an image');
        const asset = this.assertSeriesAsset(visual.promptSeriesId, input.imageAssetId);
        let article: ArticleDto | null = null;
        let socialPost: SocialPostDto | null = null;

        if (visual.articleId) {
          const current = this.articles.get(visual.articleId);
          if (current.status !== 'ACTIVE') throw new Error('The article is no longer available');
          if (!visual.selectedImageAssetId && current.revisionId !== visual.articleRevisionId) {
            throw new Error('The article changed while the image was being generated; start from the current article');
          }
          article = this.adoptIntoArticle(visual, current, input.imageAssetId, text(asset.mime_type));
        } else if (visual.socialPostId) {
          const current = this.socialPosts.get(visual.socialPostId);
          if (current.status !== 'ACTIVE') throw new Error('The social post is no longer available');
          if (!visual.selectedImageAssetId && current.revisionId !== visual.socialPostRevisionId) {
            throw new Error('The social post changed while the cover was being generated; start from the current post');
          }
          const content = socialPostContent(current);
          const mediaAssetIds = [
            input.imageAssetId,
            ...content.mediaAssetIds.filter((id) => id !== input.imageAssetId),
          ];
          socialPost = this.socialPosts.save({
            id: current.id,
            albumId: current.albumId,
            sourceInspirationStashId: current.sourceInspirationStashId,
            consumeCreationDraftId: null,
            content: { ...content, mediaAssetIds, coverAssetId: input.imageAssetId },
          });
        }

        const adoptedAt = now();
        this.db
          .prepare(
            `UPDATE derived_visuals
              SET selected_image_asset_id = ?, updated_at = ?, adopted_at = ?
              WHERE id = ?`,
          )
          .run(input.imageAssetId, adoptedAt, adoptedAt, visual.id);
        this.storage.recordChange('DERIVED_VISUAL', visual.id, 'ADOPT', {
          role: visual.role,
          imageAssetId: input.imageAssetId,
          articleId: visual.articleId,
          socialPostId: visual.socialPostId,
        });
        return { visual: this.get(visual.id), article, socialPost };
      })
      .immediate();
  }

  private adoptIntoArticle(visual: DerivedVisualDto, current: ArticleDto, imageAssetId: string, mimeType: string) {
    const content = articleContent(current);
    const preferredPath = derivedPath(visual.id, mimeType);
    const existingBinding = content.mediaBindings.find((binding) => binding.assetId === imageAssetId);
    const nextPath = existingBinding?.path ?? preferredPath;
    let mediaBindings = content.mediaBindings.map((binding) => ({ ...binding }));
    if (!existingBinding) mediaBindings.push({ path: nextPath, assetId: imageAssetId });

    let markdown = content.markdown;
    if (visual.role === 'ARTICLE_INLINE') {
      const previousBinding = visual.selectedImageAssetId
        ? mediaBindings.find((binding) => binding.assetId === visual.selectedImageAssetId)
        : null;
      if (previousBinding) {
        if (!markdown.includes(previousBinding.path))
          throw new Error('The generated illustration anchor is no longer present');
        markdown = markdown.replaceAll(previousBinding.path, nextPath);
        if (
          previousBinding.assetId !== imageAssetId &&
          previousBinding.path.startsWith(`assets/visual-${visual.id}.`) &&
          content.coverAssetId !== previousBinding.assetId
        ) {
          mediaBindings = mediaBindings.filter((binding) => binding !== previousBinding);
        }
      } else {
        const selectedText = visual.anchor?.selectedText ?? '';
        const first = markdown.indexOf(selectedText);
        if (first < 0 || first !== markdown.lastIndexOf(selectedText)) {
          throw new Error('Select a unique passage in the current article before generating an illustration');
        }
        const selectedEnd = first + selectedText.length;
        const paragraphEnd = markdown.indexOf('\n\n', selectedEnd);
        const insertionAt = paragraphEnd < 0 ? markdown.length : paragraphEnd;
        const before = markdown.slice(0, insertionAt).trimEnd();
        const after = markdown.slice(insertionAt).trimStart();
        markdown = [before, `![配图](${nextPath})`, after].filter(Boolean).join('\n\n');
      }
    } else if (visual.selectedImageAssetId && visual.selectedImageAssetId !== imageAssetId) {
      const previousBinding = mediaBindings.find((binding) => binding.assetId === visual.selectedImageAssetId);
      if (
        previousBinding &&
        previousBinding.path.startsWith(`assets/visual-${visual.id}.`) &&
        !markdown.includes(previousBinding.path)
      ) {
        mediaBindings = mediaBindings.filter((binding) => binding !== previousBinding);
      }
    }

    return this.articles.save({
      id: current.id,
      albumId: current.albumId,
      sourceInspirationStashId: current.sourceInspirationStashId,
      consumeCreationDraftId: null,
      content: {
        ...content,
        markdown,
        mediaBindings,
        coverAssetId: visual.role === 'ARTICLE_HEADER' ? imageAssetId : content.coverAssetId,
      },
    });
  }

  private assertSeriesAsset(seriesId: string, imageAssetId: string) {
    const asset = this.db
      .prepare(
        `SELECT asset.* FROM image_assets asset
          WHERE asset.id = ? AND asset.deleted_at IS NULL
            AND (
              EXISTS (
                SELECT 1 FROM generation_runs run
                JOIN prompt_versions version ON version.id = run.prompt_version_id
                WHERE version.series_id = ? AND run.result_asset_id = asset.id
              )
              OR EXISTS (
                SELECT 1 FROM creation_output_imports output
                WHERE output.series_id = ? AND output.image_asset_id = asset.id AND output.deleted_at IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM image_transform_runs transform
                WHERE transform.series_id = ? AND transform.output_asset_id = asset.id
              )
            )`,
      )
      .get(imageAssetId, seriesId, seriesId, seriesId) as JsonMap | undefined;
    if (!asset) throw new Error('The selected image does not belong to this visual generation');
    return asset;
  }

  private get(id: string) {
    const row = this.db.prepare('SELECT * FROM derived_visuals WHERE id = ?').get(id) as JsonMap | undefined;
    if (!row) throw new Error('Derived visual not found');
    return this.dto(row);
  }

  private dto(row: JsonMap): DerivedVisualDto {
    const role = derivedVisualRoleSchema.parse(row.role);
    let parsedAnchor: unknown;
    try {
      parsedAnchor = JSON.parse(text(row.anchor_json)) as unknown;
    } catch {
      throw new Error('Stored derived visual anchor is invalid');
    }
    const anchor = role === 'ARTICLE_INLINE' ? articleInlineVisualAnchorSchema.parse(parsedAnchor) : null;
    return {
      id: text(row.id),
      role,
      articleId: row.article_id == null ? null : text(row.article_id),
      articleRevisionId: row.article_revision_id == null ? null : text(row.article_revision_id),
      socialPostId: row.social_post_id == null ? null : text(row.social_post_id),
      socialPostRevisionId: row.social_post_revision_id == null ? null : text(row.social_post_revision_id),
      anchor,
      creationDraftId: text(row.creation_draft_id),
      promptSeriesId: row.prompt_series_id == null ? null : text(row.prompt_series_id),
      selectedImageAssetId: row.selected_image_asset_id == null ? null : text(row.selected_image_asset_id),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      adoptedAt: row.adopted_at == null ? null : text(row.adopted_at),
    };
  }
}
