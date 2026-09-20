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
import {
  articleCoverVisualAnchorSchema,
  articleInlineVisualAnchorSchema,
  derivedVisualRoleSchema,
} from '@/shared/contracts/derived-visual';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import { derivedVisualImageExtension, isDerivedVisualMediaPath } from '@/shared/derived-visual-media';
import { articleIllustrationInsertionOffset } from '@/shared/article-wechat-renderer';
import { adoptArticleInlineVisual } from '@/main/database/creations/article-inline-visual-adoption';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import type { IntakeRepository } from '@/main/database/creations/intake-repository';
import type { SocialPostRepository } from '@/main/database/creations/social-post-repository';
import type { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { DerivedVisualOperationRepository } from '@/main/database/creations/derived-visual-operation-repository';
import { gifOutputExists } from '@/main/database/creations/creation-output-presentation-sql';
import { derivedVisualCanvasPresetKeys } from '@/shared/derived-visual-presets';
import { ARTICLE_COVER_PRESET_KEYS, articleCoverAspectRatio } from '@/shared/article-covers';
import { articleReferenceAssetIds } from '@/shared/article-reference-assets';

const maxDraftReferenceAssets = 8;

function articleContent(article: ArticleDto): ArticleContentInput {
  const { mediaAssets: _mediaAssets, ...content } = article.content;
  return { ...content, mediaBindings: content.mediaBindings.map((binding) => ({ ...binding })) };
}

function socialPostContent(post: SocialPostDto): SocialPostContentInput {
  const { mediaAssets: _mediaAssets, ...content } = post.content;
  return { ...content, mediaAssetIds: [...content.mediaAssetIds] };
}

function socialPostReferenceAssetIds(post: SocialPostDto) {
  const orderedIds = [post.content.coverAssetId, ...post.content.mediaAssetIds];
  const seen = new Set<string>();
  return orderedIds.flatMap((id) => {
    if (!id || seen.has(id) || seen.size >= maxDraftReferenceAssets) return [];
    seen.add(id);
    return [id];
  });
}

function derivedPath(visualId: string, imageAssetId: string, mimeType: string) {
  return `assets/visual-${visualId}-${imageAssetId}.${derivedVisualImageExtension(mimeType)}`;
}

interface DerivedVisualWorkspaceTarget {
  article: ArticleDto | null;
  socialPost: SocialPostDto | null;
}

export class DerivedVisualRepository {
  readonly operations: DerivedVisualOperationRepository;
  constructor(
    private readonly storage: LibraryStorage,
    private readonly intake: IntakeRepository,
    private readonly articles: ArticleRepository,
    private readonly socialPosts: SocialPostRepository,
    private readonly creationItems: CreationItemRepository,
  ) {
    this.operations = new DerivedVisualOperationRepository(storage, articles, socialPosts, {
      get: (id) => this.get(id),
      apply: (input, current) => this.applyAdoption(input, current),
    });
  }

  private get db() {
    return this.storage.db;
  }

  list(): DerivedVisualDto[] {
    return (
      this.db
        .prepare(
          `SELECT visual.*, position.anchor_json AS position_anchor_json, position.ever_adopted
      FROM derived_visuals visual LEFT JOIN article_visual_positions position ON position.id = visual.position_id
      ORDER BY visual.created_at DESC, visual.id DESC`,
        )
        .all() as JsonMap[]
    ).map((row) => this.dto(row));
  }

  openWorkspace(input: DerivedVisualWorkspaceOpenInput): DerivedVisualWorkspaceOpenResult {
    if (input.mode === 'RESUME') return this.resumeWorkspace(input.visualId);
    if (
      input.role === 'ARTICLE_HEADER' &&
      input.coverRatio &&
      ARTICLE_COVER_PRESET_KEYS[input.coverRatio] !== input.canvasPresetKey
    )
      throw new Error('ARTICLE_COVER_CANVAS_MISMATCH');
    if (!derivedVisualCanvasPresetKeys[input.role].includes(input.canvasPresetKey)) {
      throw new Error('This canvas is unavailable for the requested visual');
    }
    return this.db
      .transaction((): DerivedVisualWorkspaceOpenResult => {
        const target = this.resolveWorkspaceTarget(input);
        const parentEntity = target.article
          ? ({ kind: 'ARTICLE', id: target.article.id } as const)
          : ({ kind: 'SOCIAL_POST', id: target.socialPost!.id } as const);
        const sourceForm = this.creationItems.getForm(input.sourceFormId);
        if (sourceForm.entity.kind !== parentEntity.kind || sourceForm.entity.id !== parentEntity.id) {
          throw new Error('The selected source form does not match this visual');
        }
        const item = this.creationItems.get(sourceForm.creationItemId);

        const role = input.role;
        const positionId = input.role === 'ARTICLE_INLINE' ? this.resolvePosition(input, target.article!) : null;
        const workspace = this.createWorkspace(input, target, positionId);
        const entity = { kind: 'DERIVED_VISUAL' as const, id: workspace.visual.id };
        if (role === 'ARTICLE_INLINE') {
          this.creationItems.addForm({
            creationItemId: item.id,
            sourceFormId: sourceForm.id,
            role,
            entity,
            anchorKey: `${positionId}:${workspace.visual.id}`,
          });
        } else {
          this.creationItems.addForm({
            creationItemId: item.id,
            sourceFormId: sourceForm.id,
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

  private resolvePosition(
    input: Extract<DerivedVisualWorkspaceCreateInput, { role: 'ARTICLE_INLINE' }>,
    article: ArticleDto,
  ) {
    if (input.positionId) {
      const position = this.db
        .prepare('SELECT article_id, anchor_json FROM article_visual_positions WHERE id = ?')
        .get(input.positionId) as JsonMap | undefined;
      if (
        !position ||
        position.article_id !== article.id ||
        JSON.stringify(articleInlineVisualAnchorSchema.parse(JSON.parse(text(position.anchor_json)))) !==
          JSON.stringify(input.anchor)
      )
        throw new Error('ARTICLE_VISUAL_POSITION_MISMATCH');
      return input.positionId;
    }
    if (articleIllustrationInsertionOffset(article.content.markdown, input.anchor.selectedText) === null)
      throw new Error('ARTICLE_VISUAL_ANCHOR_UNAVAILABLE');
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO article_visual_positions (id, article_id, source_revision_id, anchor_json, created_at)
      VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, article.id, article.revisionId, JSON.stringify(input.anchor), now());
    return id;
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
    const referenceAssetIds = target.socialPost
      ? socialPostReferenceAssetIds(target.socialPost)
      : target.article
        ? articleReferenceAssetIds(target.article.content).slice(0, maxDraftReferenceAssets)
        : [];
    return this.intake.saveDraft({
      id,
      targetAlbumId: target.article?.albumId ?? target.socialPost?.albumId ?? null,
      title: input.workspaceTitle,
      text: input.prompt,
      promptNodes: [{ kind: 'TEXT', text: input.prompt }],
      referenceAssetIds,
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
    positionId: string | null,
  ): DerivedVisualWorkspaceOpenResult {
    const draft = this.saveWorkspaceDraft(input, target, null);
    const id = ulid();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO derived_visuals
          (id, role, article_id, article_revision_id, social_post_id, social_post_revision_id,
            anchor_json, creation_draft_id, prompt_series_id, selected_image_asset_id,
            created_at, updated_at, adopted_at, position_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        input.role,
        target.article?.id ?? null,
        target.article?.revisionId ?? null,
        target.socialPost?.id ?? null,
        target.socialPost?.revisionId ?? null,
        JSON.stringify(
          input.role === 'ARTICLE_INLINE'
            ? input.anchor
            : input.role === 'ARTICLE_HEADER' && input.coverRatio
              ? { coverRatio: input.coverRatio }
              : null,
        ),
        draft.id,
        timestamp,
        timestamp,
        positionId,
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
    return this.operations.execute({ ...input, kind: 'ADOPT' });
  }

  private applyAdoption(input: DerivedVisualAdoptInput, target: ArticleDto | SocialPostDto) {
    return this.db
      .transaction(() => {
        const visual = this.get(input.id);
        if (
          (visual.role === 'ARTICLE_INLINE' && input.intent !== 'REPLACE_INLINE') ||
          (visual.role !== 'ARTICLE_INLINE' && input.intent === 'REPLACE_INLINE') ||
          (visual.role !== 'SOCIAL_POST_COVER' && input.intent === 'SET_COVER_AND_FIRST') ||
          (visual.role !== 'ARTICLE_INLINE' && input.relocateAfterText !== undefined)
        ) {
          throw new Error('The adoption action does not match this visual');
        }
        if (!visual.promptSeriesId) throw new Error('Generate this visual before adopting an image');
        const asset = this.assertSeriesAsset(visual.promptSeriesId, input.imageAssetId);
        let article: ArticleDto | null = null;
        let socialPost: SocialPostDto | null = null;

        if (visual.articleId) {
          if (target.id !== visual.articleId || !('elements' in target))
            throw new Error('DERIVED_VISUAL_TARGET_MISMATCH');
          const current = target;
          if (current.revisionId !== input.expectedRevisionId)
            throw new Error('The article changed before adoption; review the current article first');
          if (current.status !== 'ACTIVE') throw new Error('The article is no longer available');
          article =
            visual.role === 'ARTICLE_INLINE'
              ? this.articles.saveSystemRevision({
                  articleId: current.id,
                  expectedRevisionId: current.revisionId,
                  requestId: input.requestId,
                  content: adoptArticleInlineVisual(
                    visual,
                    current,
                    input,
                    derivedVisualImageExtension(text(asset.mime_type)),
                  ),
                })
              : this.adoptIntoArticle(visual, current, input.imageAssetId, text(asset.mime_type), input.requestId);
        } else if (visual.socialPostId) {
          if (target.id !== visual.socialPostId || 'elements' in target)
            throw new Error('DERIVED_VISUAL_TARGET_MISMATCH');
          const current = target;
          if (current.revisionId !== input.expectedRevisionId)
            throw new Error('The social post changed before adoption; review the current post first');
          if (current.status !== 'ACTIVE') throw new Error('The social post is no longer available');
          const content = socialPostContent(current);
          const mediaAssetIds =
            input.intent === 'SET_COVER_AND_FIRST'
              ? [input.imageAssetId, ...content.mediaAssetIds.filter((id) => id !== input.imageAssetId)]
              : content.mediaAssetIds.includes(input.imageAssetId)
                ? content.mediaAssetIds
                : [...content.mediaAssetIds, input.imageAssetId];
          socialPost = this.socialPosts.save({
            id: current.id,
            expectedRevisionId: input.expectedRevisionId,
            albumId: current.albumId,
            sourceInspirationStashId: current.sourceInspirationStashId,
            consumeCreationDraftId: null,
            content: { ...content, mediaAssetIds, coverAssetId: input.imageAssetId },
          });
        }

        const adoptedAt = now();
        if (visual.positionId)
          this.db.prepare('UPDATE article_visual_positions SET ever_adopted = 1 WHERE id = ?').run(visual.positionId);
        this.db
          .prepare(
            `UPDATE derived_visuals
              SET selected_image_asset_id = ?, updated_at = ?, adopted_at = ?
              WHERE id = ?`,
          )
          .run(input.imageAssetId, adoptedAt, adoptedAt, visual.id);
        this.storage.recordChange('DERIVED_VISUAL', visual.id, 'ADOPT', {
          role: visual.role,
          intent: input.intent,
          imageAssetId: input.imageAssetId,
          requestId: input.requestId,
          articleId: visual.articleId,
          socialPostId: visual.socialPostId,
        });
        return { visual: this.get(visual.id), article, socialPost };
      })
      .immediate();
  }

  private adoptIntoArticle(
    visual: DerivedVisualDto,
    current: ArticleDto,
    imageAssetId: string,
    mimeType: string,
    requestId: string,
  ) {
    const content = articleContent(current);
    const preferredPath = derivedPath(visual.id, imageAssetId, mimeType);
    const existingBinding = content.mediaBindings.find((binding) => binding.assetId === imageAssetId);
    const nextPath = existingBinding?.path ?? preferredPath;
    let mediaBindings = content.mediaBindings.map((binding) => ({ ...binding }));
    if (!existingBinding) mediaBindings.push({ path: nextPath, assetId: imageAssetId });

    const cropSource = visual.coverRatio
      ? (this.db
          .prepare(
            `SELECT transform.source_asset_id, source.mime_type FROM image_transform_runs transform
      JOIN image_assets source ON source.id = transform.source_asset_id AND source.deleted_at IS NULL
      WHERE transform.output_asset_id = ? AND transform.series_id = ? AND transform.kind = 'CROP'
        AND transform.deleted_at IS NULL AND ABS(1.0 * transform.ratio_width / transform.ratio_height - ?) < 0.000001`,
          )
          .get(imageAssetId, visual.promptSeriesId, articleCoverAspectRatio(visual.coverRatio)) as JsonMap | undefined)
      : undefined;
    const sourceAssetId = cropSource ? text(cropSource.source_asset_id) : imageAssetId;
    if (cropSource && !mediaBindings.some((binding) => binding.assetId === sourceAssetId))
      mediaBindings.push({
        path: derivedPath(visual.id, sourceAssetId, text(cropSource.mime_type)),
        assetId: sourceAssetId,
      });
    const markdown = content.markdown;
    const coverVariants = visual.coverRatio
      ? [
          ...(content.coverVariants ?? []).filter((cover) => cover.ratio !== visual.coverRatio),
          {
            ratio: visual.coverRatio,
            assetId: imageAssetId,
            sourceAssetId,
            crop: { x: 0.5, y: 0.5, zoom: 1 },
          },
        ]
      : content.coverVariants;
    const coverAssetId = visual.coverRatio ? (content.coverAssetId ?? sourceAssetId) : imageAssetId;
    const retained = new Set(articleReferenceAssetIds({ ...content, coverAssetId, coverVariants }));
    if (visual.selectedImageAssetId && visual.selectedImageAssetId !== imageAssetId) {
      const previousBinding = mediaBindings.find((binding) => binding.assetId === visual.selectedImageAssetId);
      if (
        previousBinding &&
        !retained.has(previousBinding.assetId) &&
        isDerivedVisualMediaPath(previousBinding.path, visual.id) &&
        !markdown.includes(previousBinding.path)
      ) {
        mediaBindings = mediaBindings.filter((binding) => binding !== previousBinding);
      }
    }

    return this.articles.saveSystemRevision({
      articleId: current.id,
      expectedRevisionId: current.revisionId,
      requestId,
      content: {
        ...content,
        markdown,
        mediaBindings,
        coverAssetId,
        ...(coverVariants?.length ? { coverVariants } : {}),
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
              OR ${gifOutputExists('?', 'asset.id')}
            )`,
      )
      .get(imageAssetId, seriesId, seriesId, seriesId, seriesId) as JsonMap | undefined;
    if (!asset) throw new Error('The selected image does not belong to this visual generation');
    return asset;
  }

  private get(id: string) {
    const row = this.db
      .prepare(
        `SELECT visual.*, position.anchor_json AS position_anchor_json, position.ever_adopted
      FROM derived_visuals visual LEFT JOIN article_visual_positions position ON position.id = visual.position_id
      WHERE visual.id = ?`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Derived visual not found');
    return this.dto(row);
  }

  private dto(row: JsonMap): DerivedVisualDto {
    const role = derivedVisualRoleSchema.parse(row.role);
    let parsedAnchor: unknown;
    try {
      parsedAnchor = JSON.parse(text(row.position_anchor_json ?? row.anchor_json)) as unknown;
    } catch {
      throw new Error('Stored derived visual anchor is invalid');
    }
    const coverRatio =
      role === 'ARTICLE_HEADER' && parsedAnchor !== null
        ? articleCoverVisualAnchorSchema.parse(parsedAnchor).coverRatio
        : undefined;
    const anchor = role === 'ARTICLE_INLINE' ? articleInlineVisualAnchorSchema.parse(parsedAnchor) : null;
    if (role === 'ARTICLE_INLINE' && (row.position_id == null || row.position_anchor_json == null))
      throw new Error('ARTICLE_VISUAL_POSITION_UNAVAILABLE');
    return {
      id: text(row.id),
      positionId: row.position_id == null ? null : text(row.position_id),
      positionWasUsed: Boolean(row.ever_adopted),
      role,
      ...(coverRatio ? { coverRatio } : {}),
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
