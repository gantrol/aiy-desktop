import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';

export type CreationAlbumMemberTargetType = 'INSPIRATION_STASH' | 'SOCIAL_POST' | 'ARTICLE';

function touchAlbum(storage: LibraryStorage, albumId: string, timestamp: string) {
  storage.db
    .prepare('UPDATE albums SET content_updated_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(timestamp, timestamp, albumId);
}

export function touchCreationAlbumMembership(
  storage: LibraryStorage,
  targetType: CreationAlbumMemberTargetType,
  targetId: string,
  timestamp: string,
) {
  const rows = storage.db
    .prepare(
      `SELECT id, album_id FROM album_members
      WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL`,
    )
    .all(targetType, targetId) as JsonMap[];
  for (const row of rows) {
    storage.db.prepare('UPDATE album_members SET updated_at = ? WHERE id = ?').run(timestamp, text(row.id));
    touchAlbum(storage, text(row.album_id), timestamp);
  }
}

/**
 * Keep revision-4 compatibility columns and the canonical ordered album edge
 * in sync. Callers own the surrounding transaction.
 */
export function syncCreationAlbumMembership(
  storage: LibraryStorage,
  targetType: CreationAlbumMemberTargetType,
  targetId: string,
  albumId: string | null,
  timestamp: string,
) {
  const currentRows = storage.db
    .prepare(
      `SELECT id, album_id FROM album_members
      WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL`,
    )
    .all(targetType, targetId) as JsonMap[];
  if (currentRows.length === 1 && text(currentRows[0].album_id) === albumId) return false;

  for (const row of currentRows) {
    const memberId = text(row.id);
    const oldAlbumId = text(row.album_id);
    storage.db
      .prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, memberId);
    storage.db
      .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
      .run(ulid(), memberId, timestamp);
    storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
      albumId: oldAlbumId,
      targetType,
      targetId,
      movedToAlbumId: albumId,
    });
    touchAlbum(storage, oldAlbumId, timestamp);
  }

  if (!albumId) return currentRows.length > 0;

  const existing = storage.db
    .prepare(
      `SELECT id FROM album_members
      WHERE album_id = ? AND target_type = ? AND target_id = ?`,
    )
    .get(albumId, targetType, targetId) as JsonMap | undefined;
  const sortOrder = Number(
    (
      storage.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
          FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
        )
        .get(albumId) as JsonMap
    ).next_order,
  );

  if (existing) {
    const memberId = text(existing.id);
    storage.db
      .prepare('UPDATE album_members SET sort_order = ?, updated_at = ?, deleted_at = NULL WHERE id = ?')
      .run(sortOrder, timestamp, memberId);
    storage.recordChange('ALBUM_MEMBER', memberId, 'RESTORE', { albumId, targetType, targetId });
  } else {
    const memberId = ulid();
    storage.db
      .prepare(
        `INSERT INTO album_members
        (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(memberId, albumId, targetType, targetId, sortOrder, timestamp, timestamp);
    storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', { albumId, targetType, targetId });
  }
  touchAlbum(storage, albumId, timestamp);
  return true;
}
