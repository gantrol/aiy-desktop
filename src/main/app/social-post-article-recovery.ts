import { createHash, randomUUID } from 'node:crypto';
import type { LibraryDatabase } from '@/main/database';
import { mediaUrl } from '@/main/database/core/values';
import type { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import type { SocialPostRecoveryStore } from '@/main/app/social-post-recovery-store';
import { socialPostArticleContent } from '@/shared/social-post-article';
import {
  articleEditorRecoveryCheckpointSchema,
  type ArticleEditorRecoveryScope,
} from '@/shared/contracts/article-editor-recovery';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';

/** Preserve unsaved legacy input in the normal article recovery queue before acknowledging it. */
export async function migrateSocialPostRecovery(
  database: LibraryDatabase,
  scope: ArticleEditorRecoveryScope,
  recovery: ArticleEditorRecoveryStore,
  posts: SocialPostRecoveryStore,
) {
  if (
    database.getLocalSpace().id !== scope.spaceId ||
    !database.db.prepare('SELECT 1 FROM article_legacy_posts WHERE article_id=?').get(scope.articleId)
  )
    return;
  const legacyScope = { spaceId: scope.spaceId, postId: scope.articleId };
  const record = await posts.load(legacyScope);
  if (!record?.snapshot) return;
  const { content: raw, baseRevisionId } = record.snapshot;
  const base = database.db
    .prepare('SELECT content_hash FROM article_revisions WHERE article_id=? AND id=?')
    .get(scope.articleId, baseRevisionId) as { content_hash: string } | undefined;
  const assets = database.db
    .prepare(
      `SELECT id AS assetId,mime_type AS mimeType,width,height,byte_size AS byteSize
    FROM image_assets WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(raw.mediaAssetIds)) as Omit<VideoDocumentRevisionMediaDto, 'mediaUrl' | 'durationMs'>[];
  const content = socialPostArticleContent(
    raw,
    assets.map((asset) => ({ id: asset.assetId, mimeType: asset.mimeType })),
  );
  await recovery.write(
    articleEditorRecoveryCheckpointSchema.parse({
      schemaVersion: 1,
      ...scope,
      sessionEpoch: 'legacy-post:' + createHash('sha256').update(record.revision).digest('hex'),
      draftSeq: 0,
      baseRevisionId,
      baseContentHash: base?.content_hash ?? createHash('sha256').update('legacy-post:unknown').digest('hex'),
      content,
      media: assets.map((asset) => ({ ...asset, mediaUrl: mediaUrl(asset.assetId), durationMs: null })),
      elements: [],
      pendingSave: null,
      updatedAt: Date.now(),
    }),
  );
  const result = await posts.save({
    schemaVersion: 1,
    ...legacyScope,
    expectedRevision: record.revision,
    revision: randomUUID(),
    snapshot: null,
  });
  if (result.status !== 'saved') throw new Error('SOCIAL_POST_RECOVERY_CONFLICT');
}
