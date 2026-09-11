import { createHash } from 'node:crypto';
import { mediaUrl } from '@/main/database/core/values';
import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { contentAssetPath, replaceContentPromptText } from '@/shared/content-document';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import type { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import { articleDraftContent, articleDraftInput } from '@/shared/article-draft';
import { desktopNoteDraftSchema } from '@/shared/contracts/desktop-petals';
import {
  articleEditorRecoveryCheckpointSchema,
  type ArticleEditorRecoveryScope,
} from '@/shared/contracts/article-editor-recovery';

function recoveryMedia(database: LibraryDatabase, ids: string[]): VideoDocumentRevisionMediaDto[] {
  const assets = database.db
    .prepare(
      'SELECT id AS assetId,mime_type AS mimeType,width,height,byte_size AS byteSize FROM image_assets WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))',
    )
    .all(JSON.stringify(ids)) as Omit<VideoDocumentRevisionMediaDto, 'mediaUrl' | 'durationMs'>[];
  return assets.map((asset) => ({ ...asset, mediaUrl: mediaUrl(asset.assetId), durationMs: null }));
}

/** Copy a bounded batch durably before acknowledging each exact legacy checkpoint. */
export async function migrateArticleNoteRecovery(
  database: LibraryDatabase,
  scope: ArticleEditorRecoveryScope,
  recovery: ArticleEditorRecoveryStore,
) {
  if (database.getLocalSpace().id !== scope.spaceId) return;
  const rows = database.db
    .prepare(
      'SELECT editor_id,draft_json,updated_at FROM content_editor_drafts WHERE source_id=? ORDER BY updated_at DESC LIMIT 32',
    )
    .all(scope.articleId) as { editor_id: string; draft_json: string; updated_at: string }[];
  if (!rows.length) return;
  const article = database.getArticle(scope.articleId);
  for (const row of rows) {
    const draft = desktopNoteDraftSchema.parse(JSON.parse(row.draft_json));
    const input = articleDraftInput(article.content);
    const referenceAssetIds = draft.referenceAssetIds ?? input.referenceAssetIds;
    const reconstructed = !draft.document && Boolean(input.document) && draft.text !== input.manualPrompt;
    const document =
      draft.document ??
      (reconstructed
        ? markdownBlockDocument(
            draft.text,
            referenceAssetIds.map((assetId) => ({ assetId, path: contentAssetPath(assetId) })),
          )
        : input.document);
    const content = articleDraftContent(
      {
        ...input,
        schemaVersion: document ? 2 : 1,
        title: draft.title ?? input.title,
        format: draft.format ?? input.format,
        manualPrompt: draft.text,
        document,
        promptNodes: replaceContentPromptText(input.promptNodes, draft.text),
        referenceAssetIds,
      },
      article.content,
    );
    const revision = database.db
      .prepare(
        'SELECT id FROM article_revisions WHERE article_id=? AND content_hash=? ORDER BY revision_no DESC LIMIT 1',
      )
      .get(article.id, draft.expectedContentHash) as { id: string } | undefined;
    await recovery.write(
      articleEditorRecoveryCheckpointSchema.parse({
        schemaVersion: 1,
        spaceId: scope.spaceId,
        articleId: article.id,
        sessionEpoch: 'legacy-note:' + createHash('sha256').update(row.editor_id).digest('hex'),
        draftSeq: draft.sequence,
        baseRevisionId: draft.expectedRevisionId ?? revision?.id ?? 'legacy-note:unknown',
        baseContentHash: draft.expectedContentHash,
        content,
        media: recoveryMedia(
          database,
          content.mediaBindings.map((binding) => binding.assetId),
        ),
        elements: reconstructed ? [] : (draft.elements ?? article.elements),
        commentAnchors: reconstructed ? undefined : draft.commentAnchors,
        pendingSave: null,
        updatedAt: Date.parse(row.updated_at),
      }),
    );
    database.db
      .prepare('DELETE FROM content_editor_drafts WHERE source_id=? AND editor_id=? AND draft_json=?')
      .run(article.id, row.editor_id, row.draft_json);
  }
}

export function bindArticleNoteRecovery(
  database: LibraryDatabase,
  recovery: ArticleEditorRecoveryStore,
  run?: import('@/main/ipc/trusted-handlers').TrustedIpcInvocationRunner,
) {
  recovery.setLegacyDraftMigration(async (scope) => {
    const migrate = () => migrateArticleNoteRecovery(database, scope, recovery);
    if (run) await run('article-editor-recovery:list', migrate);
    else await migrate();
  });
}
