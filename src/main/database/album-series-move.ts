import { ulid } from 'ulid';
import type { AlbumMoveSeriesInput } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

function assertAlbumAcceptsContent(storage: LibraryStorage, albumId: string) {
  const db = storage.db;
  if (!db.prepare('SELECT 1 FROM albums WHERE id = ? AND deleted_at IS NULL').get(albumId)) {
    throw new Error('Album not found');
  }
  const archived = db
    .prepare(
      `WITH RECURSIVE lineage(id, archived_at) AS (
      SELECT id, archived_at FROM albums WHERE id = ? AND deleted_at IS NULL
      UNION
      SELECT parent.id, parent.archived_at
      FROM lineage child
      JOIN album_members relation
        ON relation.target_type = 'ALBUM'
        AND relation.target_id = child.id
        AND relation.deleted_at IS NULL
      JOIN albums parent ON parent.id = relation.album_id AND parent.deleted_at IS NULL
    )
    SELECT 1 FROM lineage WHERE archived_at IS NOT NULL LIMIT 1`,
    )
    .get(albumId);
  if (archived) throw new Error('Archived albums cannot accept new content');
}

export function moveAlbumSeries(storage: LibraryStorage, input: AlbumMoveSeriesInput): void {
  const seriesIds = [...new Set(input.seriesIds)];
  if (seriesIds.length === 0) return;

  storage.db.transaction(() => {
    const db = storage.db;
    if (input.albumId) assertAlbumAcceptsContent(storage, input.albumId);

    const findSeries = db.prepare('SELECT 1 FROM prompt_series WHERE id = ? AND deleted_at IS NULL');
    for (const seriesId of seriesIds) {
      if (!findSeries.get(seriesId)) throw new Error('Creation not found');
    }

    const timestamp = now();
    const touchedAlbumIds = new Set<string>();
    const findActiveMemberships = db.prepare(
      `SELECT id, album_id FROM album_members
      WHERE target_type = 'SERIES' AND target_id = ? AND deleted_at IS NULL`,
    );
    const softDeleteMembership = db.prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?');
    const addMembershipTombstone = db.prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')");
    const findTargetMembership = input.albumId
      ? db.prepare(
          `SELECT id, deleted_at FROM album_members
          WHERE album_id = ? AND target_type = 'SERIES' AND target_id = ?`,
        )
      : null;
    const restoreTargetMembership = db.prepare(
      `UPDATE album_members
      SET sort_order = ?, updated_at = ?, deleted_at = NULL
      WHERE id = ?`,
    );
    const insertTargetMembership = db.prepare(
      `INSERT INTO album_members
      (id, album_id, target_type, target_id, sort_order, created_at, updated_at)
      VALUES (?, ?, 'SERIES', ?, ?, ?, ?)`,
    );
    const touchAlbumContent = db.prepare(
      `UPDATE albums
      SET updated_at = ?, content_updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
    );
    let nextOrder = input.albumId
      ? Number(
          (
            db
              .prepare(
                `SELECT COALESCE(MAX(sort_order), -1) AS max_order
                FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
              )
              .get(input.albumId) as JsonMap
          ).max_order,
        ) + 1
      : 0;

    for (const seriesId of seriesIds) {
      const activeMemberships = findActiveMemberships.all(seriesId) as JsonMap[];
      let alreadyInTarget = false;
      for (const membership of activeMemberships) {
        const memberId = text(membership.id);
        const oldAlbumId = text(membership.album_id);
        if (oldAlbumId === input.albumId) {
          alreadyInTarget = true;
          continue;
        }
        softDeleteMembership.run(timestamp, timestamp, memberId);
        addMembershipTombstone.run(ulid(), memberId, timestamp);
        storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
          albumId: oldAlbumId,
          targetType: 'SERIES',
          targetId: seriesId,
          movedToAlbumId: input.albumId,
        });
        touchedAlbumIds.add(oldAlbumId);
      }

      if (!input.albumId || alreadyInTarget || !findTargetMembership) continue;
      const existing = findTargetMembership.get(input.albumId, seriesId) as JsonMap | undefined;
      const memberId = existing ? text(existing.id) : ulid();
      if (existing) {
        restoreTargetMembership.run(nextOrder, timestamp, memberId);
        storage.recordChange('ALBUM_MEMBER', memberId, 'RESTORE', {
          albumId: input.albumId,
          targetType: 'SERIES',
          targetId: seriesId,
        });
      } else {
        insertTargetMembership.run(memberId, input.albumId, seriesId, nextOrder, timestamp, timestamp);
        storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
          albumId: input.albumId,
          targetType: 'SERIES',
          targetId: seriesId,
        });
      }
      nextOrder += 1;
      touchedAlbumIds.add(input.albumId);
    }

    for (const albumId of touchedAlbumIds) touchAlbumContent.run(timestamp, timestamp, albumId);
  })();
}
