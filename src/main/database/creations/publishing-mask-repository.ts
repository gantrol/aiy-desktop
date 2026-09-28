import { ulid } from 'ulid';
import { now } from '@/main/database/core/values';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import { plainTextMarkdown } from '@/shared/content-document';
import { projectNumberedGallery } from '@/shared/content-publishing-mask';
import {
  publishingMaskDraftSchema,
  publishingMaskSaveInputSchema,
  type PublishingMaskDraft,
  type PublishingMaskReadResult,
  type PublishingMaskScope,
  type PublishingMaskSaveInput,
} from '@/shared/contracts/publishing-mask';

type Repositories = Pick<LibraryDatabaseRepositories, 'storage' | 'articles' | 'socialPosts'>;

export class PublishingMaskRepository {
  constructor(
    private readonly repositories: Repositories,
    private readonly content: ContentLibraryRepository,
  ) {}

  private get db() {
    return this.repositories.storage.db;
  }

  private assertSpace(spaceId: string) {
    if (this.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== spaceId)
      throw new Error('PUBLISHING_MASK_SPACE_CHANGED');
  }

  private source(input: PublishingMaskScope): PublishingMaskReadResult['source'] {
    const article = input.source.kind === 'ARTICLE';
    const table = article ? 'articles' : 'social_post_drafts';
    if (
      !this.db
        .prepare(`SELECT 1 FROM ${table} WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`)
        .get(input.source.id)
    )
      throw new Error('PUBLISHING_MASK_UNAVAILABLE');
    const item = article
      ? this.repositories.articles.get(input.source.id)
      : this.repositories.socialPosts.get(input.source.id);
    if (input.expectedSourceRevisionId && item.revisionId !== input.expectedSourceRevisionId)
      throw new Error('PUBLISHING_MASK_SOURCE_CHANGED');
    const value = item.content;
    const markdown =
      'markdown' in value ? value.markdown : value.format === 'markdown' ? value.body : plainTextMarkdown(value.body);
    const expanded = this.content.render(markdown);
    const bindings =
      'mediaBindings' in value
        ? value.mediaBindings
        : value.mediaAssetIds.map((id) => ({ path: `aiy-media://asset/${encodeURIComponent(id)}`, assetId: id }));
    const assets = value.mediaAssets;
    const coverFirst = article || input.target.platform === 'xiaohongshu';
    const projected = projectNumberedGallery({
      markdown: expanded.markdown,
      leadingMediaAssetIds: coverFirst && value.coverAssetId ? [value.coverAssetId] : [],
      mediaAssetIds: 'mediaAssetIds' in value ? value.mediaAssetIds : [],
      mediaBindings: [...bindings, ...expanded.media],
      numbering: 'decimal',
      imageLabel: String,
    });
    if (projected.missingImages.length) throw new Error('PUBLISHING_MASK_MEDIA_CHANGED');
    const urls = new Map([
      ...assets.map((asset) => [asset.id, asset.mediaUrl] as const),
      ...expanded.media.map((asset) => [asset.assetId, asset.mediaUrl] as const),
    ]);
    const mediaIds = [...new Set([...projected.mediaAssetIds, ...(value.coverAssetId ? [value.coverAssetId] : [])])];
    return {
      revisionId: item.revisionId,
      title: value.title,
      coverAssetId: value.coverAssetId,
      media: mediaIds.map((id) => ({ id, mediaUrl: urls.get(id) ?? '' })),
    };
  }

  private stored(input: PublishingMaskScope): PublishingMaskDraft | null {
    const column = input.source.kind === 'ARTICLE' ? 'article_id' : 'social_post_id';
    const row = this.db
      .prepare(`SELECT draft_json FROM publishing_mask_drafts WHERE ${column} = ? AND platform = ? AND format = ?`)
      .get(input.source.id, input.target.platform, input.target.format) as { draft_json: string } | undefined;
    return row ? publishingMaskDraftSchema.parse(JSON.parse(row.draft_json)) : null;
  }

  read(input: PublishingMaskScope): PublishingMaskReadResult {
    return this.db.transaction(() => {
      this.assertSpace(input.expectedSpaceId);
      return { draft: this.stored(input), source: this.source(input) };
    })();
  }

  get(input: PublishingMaskScope): PublishingMaskDraft | null {
    return this.db.transaction(() => {
      this.assertSpace(input.expectedSpaceId);
      const table = input.source.kind === 'ARTICLE' ? 'articles' : 'social_post_drafts';
      const revisionId = this.db
        .prepare(`SELECT current_revision_id FROM ${table} WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`)
        .pluck()
        .get(input.source.id);
      if (!revisionId) throw new Error('PUBLISHING_MASK_UNAVAILABLE');
      if (input.expectedSourceRevisionId && revisionId !== input.expectedSourceRevisionId)
        throw new Error('PUBLISHING_MASK_SOURCE_CHANGED');
      return this.stored(input);
    })();
  }

  save(rawInput: PublishingMaskSaveInput): PublishingMaskDraft {
    const input = publishingMaskSaveInputSchema.parse(rawInput);
    return this.db.transaction(() => {
      this.assertSpace(input.expectedSpaceId);
      const current = this.stored(input);
      // IPC may lose the reply after the transaction commits. A complete match
      // confirms that write without incrementing its version or overwriting it.
      if (
        current &&
        current.sourceRevisionId === input.sourceRevisionId &&
        JSON.stringify(current.overrides) === JSON.stringify(input.overrides)
      )
        return current;
      if ((current?.version ?? null) !== input.expectedVersion) throw new Error('PUBLISHING_MASK_CONFLICT');
      const source = this.source(input);
      // A saved draft may keep an older basis, but it must belong to this exact source.
      if (source.revisionId !== input.sourceRevisionId)
        this.content.read({ ...input.source, revisionId: input.sourceRevisionId });
      const available = new Set(source.media.map((media) => media.id));
      if (
        input.overrides.mediaOrder?.some((id) => !available.has(id)) ||
        (input.overrides.cover.mode === 'CUSTOM' && !available.has(input.overrides.cover.value))
      )
        throw new Error('PUBLISHING_MASK_MEDIA_CHANGED');
      const draft: PublishingMaskDraft = {
        id: current?.id ?? ulid(),
        version: (current?.version ?? 0) + 1,
        source: input.source,
        target: input.target,
        ruleVersion: 1,
        sourceRevisionId: input.sourceRevisionId,
        overrides: input.overrides,
        updatedAt: now(),
      };
      if (current) {
        const updated = this.db
          .prepare(
            'UPDATE publishing_mask_drafts SET version = ?, draft_json = ?, updated_at = ? WHERE id = ? AND version = ?',
          )
          .run(draft.version, JSON.stringify(draft), draft.updatedAt, draft.id, current.version);
        if (updated.changes !== 1) throw new Error('PUBLISHING_MASK_CONFLICT');
      } else {
        this.db
          .prepare(
            'INSERT INTO publishing_mask_drafts (id, article_id, social_post_id, platform, format, version, draft_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            draft.id,
            input.source.kind === 'ARTICLE' ? input.source.id : null,
            input.source.kind === 'SOCIAL_POST' ? input.source.id : null,
            input.target.platform,
            input.target.format,
            draft.version,
            JSON.stringify(draft),
            draft.updatedAt,
          );
      }
      return draft;
    })();
  }
}
