import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';
import type { CreationDraftListInput, CreationDraftListResult } from '@/shared/contracts/creation-draft-list';

export const savedCreationDraftScope = `
    FROM creation_drafts draft
    LEFT JOIN albums album ON album.id = draft.target_album_id
    WHERE draft.consumed_at IS NULL AND draft.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM derived_visuals visual WHERE visual.creation_draft_id = draft.id)
      AND (
        trim(draft.title) <> '' OR trim(draft.text_content) <> ''
        OR json_array_length(draft.term_ids_json) > 0
        OR draft.palette_references_json <> coalesce(json_extract(album.defaults_json, '$.recipes'), '[]')
        OR EXISTS (
          SELECT 1 FROM creation_draft_materials link
          JOIN materials material ON material.id = link.material_id AND material.deleted_at IS NULL
          WHERE link.creation_draft_id = draft.id
        )
        OR EXISTS (
          SELECT 1 FROM json_tree(draft.prompt_nodes_json) node
          WHERE (node.key = 'text' AND node.type = 'text' AND trim(node.value) <> '')
            OR (node.key = 'type' AND node.value IN (
              'creatorTerm', 'image', 'contentReference', 'linkCard', 'inlineMath', 'blockMath', 'horizontalRule'
            ))
        )
      )`;

/** Read summaries in one bounded query; opening a draft owns full document and media hydration. */
export function listCreationDrafts(db: LibraryStorage['db'], input: CreationDraftListInput): CreationDraftListResult {
  const rows = db
    .prepare(
      `
    SELECT draft.id, draft.title, substr(draft.text_content, 1, 160) AS preview,
      draft.target_album_id, draft.updated_at
    ${savedCreationDraftScope}
      AND (@query = '' OR instr(lower(draft.title || char(10) || draft.text_content), lower(@query)) > 0)
      AND (@updatedAt IS NULL OR (draft.updated_at, draft.id) < (@updatedAt, @id))
    ORDER BY draft.updated_at DESC, draft.id DESC LIMIT @limit
  `,
    )
    .all({
      query: input.query,
      updatedAt: input.cursor?.updatedAt ?? null,
      id: input.cursor?.id ?? null,
      limit: input.limit + 1,
    }) as JsonMap[];
  const items = rows.slice(0, input.limit).map((row) => ({
    id: text(row.id),
    title: text(row.title),
    preview: text(row.preview).slice(0, 160),
    targetAlbumId: row.target_album_id ? text(row.target_album_id) : null,
    updatedAt: text(row.updated_at),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > input.limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
  };
}
