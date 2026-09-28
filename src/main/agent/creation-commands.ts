import type { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import {
  agentCreationAlbumsSchema,
  agentCreationEnsureAlbumSchema,
  agentCreationMoveSchema,
} from '@/shared/contracts/agent-creation';

const failure = (code: string) => Object.assign(new Error(code), { code: `AIY_AGENT_CREATION_${code}` });
function assertSpace(database: LibraryDatabase, spaceId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (database.getLocalSpace().id !== spaceId) throw failure('SPACE_CONFLICT');
}

// Metadata only: album discovery never loads article bodies or gallery projections.
const availableAlbums = `WITH RECURSIVE unavailable(id) AS (
  SELECT id FROM albums WHERE archived_at IS NOT NULL OR deleted_at IS NOT NULL
  UNION SELECT member.target_id FROM unavailable parent JOIN album_members member
    ON member.album_id=parent.id AND member.target_type='ALBUM' AND member.deleted_at IS NULL
) SELECT album.id, album.title, parent.album_id AS parentAlbumId
  FROM albums album LEFT JOIN album_members parent
    ON parent.target_type='ALBUM' AND parent.target_id=album.id AND parent.deleted_at IS NULL
  WHERE album.intent <> 'MATERIAL_LIBRARY' AND NOT EXISTS (SELECT 1 FROM unavailable WHERE id=album.id)`;
type Album = { id: string; title: string; parentAlbumId: string | null };

export function listAgentCreationAlbums(
  database: LibraryDatabase,
  input: z.infer<typeof agentCreationAlbumsSchema>,
  signal: AbortSignal,
) {
  assertSpace(database, input.spaceId, signal);
  const rows = database.db
    .prepare(`${availableAlbums} ORDER BY album.id LIMIT ? OFFSET ?`)
    .all(input.limit + 1, input.offset) as Album[];
  return {
    spaceId: input.spaceId,
    albums: rows.slice(0, input.limit),
    nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
  };
}

export function ensureAgentCreationAlbum(
  database: LibraryDatabase,
  input: z.infer<typeof agentCreationEnsureAlbumSchema>,
  signal: AbortSignal,
) {
  return database.db
    .transaction(() => {
      assertSpace(database, input.spaceId, signal);
      if (input.parentAlbumId && !database.db.prepare(`${availableAlbums} AND album.id=?`).get(input.parentAlbumId))
        throw failure('PARENT_UNAVAILABLE');
      const matches = database.db
        .prepare(`${availableAlbums} AND album.title=? AND parent.album_id IS ? LIMIT 2`)
        .all(input.title, input.parentAlbumId) as Album[];
      if (matches.length > 1) throw failure('TITLE_CONFLICT');
      if (matches[0]) return { spaceId: input.spaceId, album: matches[0], created: false };
      const created = database.createAlbum({
        title: input.title,
        titleLocale: input.locale,
        parentAlbumId: input.parentAlbumId,
      });
      return {
        spaceId: input.spaceId,
        album: { id: created.id, title: created.title, parentAlbumId: input.parentAlbumId },
        created: true,
      };
    })
    .immediate();
}

/** Move only the explicitly selected leaf items. A mixed or stale batch rolls back in full. */
export function moveAgentCreations(
  database: LibraryDatabase,
  input: z.infer<typeof agentCreationMoveSchema>,
  signal: AbortSignal,
) {
  return database.db
    .transaction(() => {
      assertSpace(database, input.spaceId, signal);
      if (!database.db.prepare(`${availableAlbums} AND album.id=?`).get(input.albumId))
        throw failure('ALBUM_UNAVAILABLE');
      const rows = database.db
        .prepare(
          `SELECT DISTINCT item.id, member.album_id AS albumId, edge.parent_creation_item_id AS parentId,
      article.id AS articleId,
      EXISTS (SELECT 1 FROM creation_item_parents child WHERE child.parent_creation_item_id=item.id) AS hasChildren
      FROM creation_items item
      LEFT JOIN album_members member ON member.target_type='CREATION_ITEM' AND member.target_id=item.id AND member.deleted_at IS NULL
      LEFT JOIN creation_item_parents edge ON edge.creation_item_id=item.id
      LEFT JOIN creation_forms form ON form.creation_item_id=item.id AND form.entity_type='ARTICLE' AND form.deleted_at IS NULL
      LEFT JOIN articles article ON article.id=form.entity_id AND article.deleted_at IS NULL AND article.status='ACTIVE'
      WHERE item.deleted_at IS NULL AND item.archived_at IS NULL AND (
        item.id IN (SELECT json_extract(value,'$.creationItemId') FROM json_each(?)) OR
        article.id IN (SELECT json_extract(value,'$.articleId') FROM json_each(?)))`,
        )
        .all(JSON.stringify(input.entries), JSON.stringify(input.entries)) as {
        id: string;
        albumId: string | null;
        parentId: string | null;
        articleId: string | null;
        hasChildren: number;
      }[];
      const seen = new Set<string>();
      const selected = input.entries.map((entry) => {
        const matches = rows.filter((row) =>
          entry.creationItemId ? row.id === entry.creationItemId : row.articleId === entry.articleId,
        );
        const ids = new Set(matches.map((row) => row.id));
        const row = matches[0];
        if (!row || ids.size !== 1 || seen.has(row.id)) throw failure('ITEM_UNAVAILABLE');
        seen.add(row.id);
        if (row.hasChildren) throw failure('ITEM_HAS_CHILDREN');
        if (
          row.parentId !== entry.expectedParentCreationItemId &&
          !(row.albumId === input.albumId && row.parentId === null)
        )
          throw failure('PARENT_CONFLICT');
        if (row.albumId !== input.albumId && row.albumId !== entry.expectedAlbumId)
          throw failure('MEMBERSHIP_CONFLICT');
        // Cross-album moves detach a selected child; retries already in the destination are no-ops.
        return { row, entry };
      });
      const entries = selected.map(({ row, entry }) => {
        if (row.albumId === input.albumId) return { creationItemId: row.id, moved: false };
        signal.throwIfAborted();
        database.moveCreationItem({
          creationItemId: row.id,
          albumId: input.albumId,
          parentCreationItemId: null,
          expectedParentCreationItemId: entry.expectedParentCreationItemId,
        });
        return { creationItemId: row.id, moved: true };
      });
      return { spaceId: input.spaceId, albumId: input.albumId, entries };
    })
    .immediate();
}
