import type Database from 'better-sqlite3';
import type { ArticleContentInput, ArticleDto, ArticleSummaryDto } from '@/shared/contracts';
import { readArticleMediaAssets } from '@/main/database/creations/article-media-assets';
import type { AuthorSummary, ContentWriteContext } from '@/shared/contracts/authorship';
import { text, type JsonMap } from '@/main/database/core/values';
import { articleReadMetadata } from '@/main/database/creations/article-read-metadata';

/** Only list metadata crosses IPC; selected articles use the complete, validated read path. */
export function readArticleSummaries(
  db: Database.Database,
  readPacked: (rows: JsonMap[]) => Map<string, ArticleContentInput>,
): ArticleSummaryDto[] {
  const rows = db
    .prepare(
      `
      SELECT article.*, revision.id AS revision_id, revision.revision_no,
        revision.article_id AS revision_article_id, revision.content_hash,
        revision.content_pack_id, revision.content_pack_entry_index,
        CASE WHEN revision.content_pack_id IS NULL THEN json_object(
          'title', json_extract(revision.content_json, '$.title'),
          'editorMode', json_extract(revision.content_json, '$.editorMode'),
          'mediaBindings', json_extract(revision.content_json, '$.mediaBindings'),
          'coverAssetId', json_extract(revision.content_json, '$.coverAssetId'),
          'coverVariants', json_extract(revision.content_json, '$.coverVariants'),
          'hasCreationInput', json_type(revision.content_json, '$.creationInput') = 'object'
        ) ELSE NULL END AS summary_json,
        CASE WHEN revision.content_pack_id IS NULL THEN substr(COALESCE(
          NULLIF(json_extract(revision.content_json, '$.markdown'), ''),
          (SELECT group_concat(atom, char(10)) FROM (
            SELECT atom FROM json_tree(revision.content_json, '$.document')
            WHERE key = 'text' AND type = 'text' LIMIT 12
          )), ''), 1, 2000) ELSE '' END AS preview_markdown,
        '' AS content_json
      FROM articles article JOIN article_revisions revision ON revision.id = article.current_revision_id
      WHERE article.status = 'ACTIVE' AND article.deleted_at IS NULL
      ORDER BY article.updated_at DESC, article.id DESC
    `,
    )
    .all() as JsonMap[];
  // Historical packed locators remain readable without issuing per-article queries.
  const packed = readPacked(rows.filter((row) => row.summary_json === null));
  const summaries = rows.map((row) => {
    const content =
      row.summary_json === null
        ? packed.get(text(row.revision_id))!
        : (JSON.parse(text(row.summary_json)) as ArticleContentInput & { hasCreationInput: boolean });
    return {
      title: content.title,
      ...(content.editorMode ? { editorMode: content.editorMode } : {}),
      mediaBindings: content.mediaBindings,
      coverAssetId: content.coverAssetId,
      ...(content.coverVariants ? { coverVariants: content.coverVariants } : {}),
      hasCreationInput:
        'hasCreationInput' in content ? Boolean(content.hasCreationInput) : Boolean(content.creationInput),
    };
  });
  const assets = readArticleMediaAssets(
    db,
    summaries.flatMap((content) => content.mediaBindings.map((binding) => binding.assetId)),
  );
  return articleReadMetadata(db, rows).map((row, index) => {
    const { hasCreationInput, ...content } = summaries[index];
    return {
      id: text(row.id),
      albumId: row.album_id == null ? null : text(row.album_id),
      sourceInspirationStashId: row.source_inspiration_stash_id == null ? null : text(row.source_inspiration_stash_id),
      revisionId: text(row.revision_id),
      revisionNo: Number(row.revision_no),
      contentHash: text(row.content_hash),
      status: text(row.status) as ArticleDto['status'],
      authors: row.authors as AuthorSummary[],
      writeContext: row.write_context as ContentWriteContext | undefined,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      detailsLoaded: false,
      hasCreationInput,
      previewMarkdown:
        row.summary_json === null
          ? (packed.get(text(row.revision_id))?.markdown ?? '').slice(0, 2000)
          : text(row.preview_markdown),
      content: {
        ...content,
        mediaAssets: [...new Set(content.mediaBindings.map((binding) => binding.assetId))].flatMap(
          (id) => assets.get(id) ?? [],
        ),
      },
    };
  });
}
