import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';

/** Retained edges through archived/deleted parents must not form a cycle on restoration. */
export function assertCreationParent(storage: LibraryStorage, id: string, parentId: string) {
  const ancestors = storage.db
    .prepare(
      `WITH RECURSIVE lineage(id) AS (
    SELECT ? UNION SELECT edge.parent_creation_item_id FROM lineage
      JOIN creation_item_parents edge ON edge.creation_item_id = lineage.id
  ) SELECT id FROM lineage LIMIT 4001`,
    )
    .all(parentId) as { id: string }[];
  if (ancestors.length > 4000 || ancestors.some((ancestor) => ancestor.id === id))
    throw new Error('CREATION_PARENT_CYCLE');
}

export function creationBranchIds(storage: LibraryStorage, id: string) {
  const rows = storage.db
    .prepare(
      `
    WITH RECURSIVE branch(id) AS (
      SELECT id FROM creation_items WHERE id = ? AND deleted_at IS NULL
      UNION
      SELECT child.id FROM branch
      JOIN creation_item_parents edge ON edge.parent_creation_item_id = branch.id
      JOIN creation_items child ON child.id = edge.creation_item_id AND child.deleted_at IS NULL
    ) SELECT id FROM branch LIMIT 4001
  `,
    )
    .all(id) as { id: string }[];
  if (rows.length > 4000) throw new Error('CREATION_BRANCH_LIMIT');
  return rows.map((row) => row.id);
}

/** Move the branch as one set, including compatibility locations used by existing readers. */
export function moveCreationBranchAlbums(
  storage: LibraryStorage,
  ids: readonly string[],
  albumId: string | null,
  timestamp: string,
) {
  const { db } = storage;
  const selection = JSON.stringify(ids);
  const changed = db
    .prepare(
      `
    SELECT item.id, member.id AS member_id, member.album_id
    FROM creation_items item JOIN json_each(?) selected ON selected.value = item.id
    LEFT JOIN album_members member ON member.target_type = 'CREATION_ITEM'
      AND member.target_id = item.id AND member.deleted_at IS NULL
    WHERE member.album_id IS NOT ?
  `,
    )
    .all(selection, albumId) as { id: string; member_id: string | null; album_id: string | null }[];
  if (!changed.length) return false;
  const changedIds = JSON.stringify(changed.map((row) => row.id));
  db.prepare(
    `
    INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state)
    SELECT lower(hex(randomblob(16))), 'ALBUM_MEMBER', id, ?, 'LOCAL_ONLY'
    FROM album_members WHERE target_type = 'CREATION_ITEM' AND deleted_at IS NULL
      AND target_id IN (SELECT value FROM json_each(?))
  `,
  ).run(timestamp, changedIds);
  db.prepare(
    `UPDATE album_members SET deleted_at = ?, updated_at = ?
    WHERE target_type = 'CREATION_ITEM' AND deleted_at IS NULL
      AND target_id IN (SELECT value FROM json_each(?))`,
  ).run(timestamp, timestamp, changedIds);
  if (albumId) {
    const existing = new Map(
      (
        db
          .prepare(
            `
      SELECT target_id, id FROM album_members WHERE album_id = ? AND target_type = 'CREATION_ITEM'
        AND target_id IN (SELECT value FROM json_each(?))
    `,
          )
          .all(albumId, changedIds) as { target_id: string; id: string }[]
      ).map((row) => [row.target_id, row.id]),
    );
    const order = Number(
      db
        .prepare(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 FROM album_members WHERE album_id = ? AND deleted_at IS NULL',
        )
        .pluck()
        .get(albumId),
    );
    const members = changed.map((row, index) => ({
      id: existing.get(row.id) ?? ulid(),
      target: row.id,
      order: order + index,
    }));
    db.prepare(
      `
      INSERT INTO album_members(id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
      SELECT json_extract(value, '$.id'), ?, 'CREATION_ITEM', json_extract(value, '$.target'),
        json_extract(value, '$.order'), ?, ?, NULL FROM json_each(?) WHERE 1
      ON CONFLICT(id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = excluded.updated_at, deleted_at = NULL
    `,
    ).run(albumId, timestamp, timestamp, JSON.stringify(members));
    for (const member of members)
      storage.recordChange('ALBUM_MEMBER', member.id, 'MOVE', {
        albumId,
        targetType: 'CREATION_ITEM',
        targetId: member.target,
      });
  }
  const locations = [
    ['INSPIRATION_STASH', 'inspiration_stashes', 'INSPIRATION_STASH'],
    ['SOCIAL_POST', 'social_post_drafts', 'SOCIAL_POST_DRAFT'],
    ['ARTICLE', 'articles', 'ARTICLE'],
    ['EVALUATION_SUITE', 'evaluation_suites', 'EVALUATION_SUITE'],
  ] as const;
  for (const [entityType, table, changeType] of locations) {
    const entities = db
      .prepare(
        `SELECT entity.id FROM ${table} entity
      JOIN creation_forms form ON form.entity_id = entity.id AND form.entity_type = ? AND form.deleted_at IS NULL
      WHERE form.creation_item_id IN (SELECT value FROM json_each(?)) AND entity.album_id IS NOT ?
    `,
      )
      .all(entityType, changedIds, albumId) as { id: string }[];
    if (!entities.length) continue;
    db.prepare(`UPDATE ${table} SET album_id = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))`).run(
      albumId,
      timestamp,
      JSON.stringify(entities.map((row) => row.id)),
    );
    for (const entity of entities)
      storage.recordChange(
        changeType,
        entity.id,
        'MOVE',
        { albumId },
        { affectsFileView: entityType === 'INSPIRATION_STASH' },
      );
  }
  const albumIds = [
    ...new Set([...changed.flatMap((row) => (row.album_id ? [row.album_id] : [])), ...(albumId ? [albumId] : [])]),
  ];
  db.prepare(
    `UPDATE albums SET content_updated_at = ?, updated_at = ?
    WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`,
  ).run(timestamp, timestamp, JSON.stringify(albumIds));
  db.prepare('UPDATE creation_items SET updated_at = ? WHERE id IN (SELECT value FROM json_each(?))').run(
    timestamp,
    changedIds,
  );
  for (const row of changed) {
    if (row.member_id)
      storage.recordChange('ALBUM_MEMBER', row.member_id, 'DELETE', {
        albumId: row.album_id,
        targetType: 'CREATION_ITEM',
        targetId: row.id,
        movedToAlbumId: albumId,
      });
    storage.recordChange('CREATION_ITEM', row.id, 'MOVE', { albumId });
  }
  return true;
}
