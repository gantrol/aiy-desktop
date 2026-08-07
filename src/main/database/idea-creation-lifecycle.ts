import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

function liveCreationForScope(storage: LibraryStorage, kind: 'DRAFT' | 'SERIES', id: string) {
  return storage.db
    .prepare(
      `SELECT * FROM creations
      WHERE source_scope_kind = ? AND source_scope_id = ?
        AND deleted_at IS NULL AND status <> 'ARCHIVED'
      ORDER BY
        CASE status WHEN 'ACTIVE' THEN 0 WHEN 'FORMING' THEN 1 ELSE 2 END,
        created_at, id
      LIMIT 1`,
    )
    .get(kind, id) as JsonMap | undefined;
}

function strongestStatus(left: string, right: string) {
  const rank = new Map([
    ['FAILED', 0],
    ['FORMING', 1],
    ['ACTIVE', 2],
  ]);
  return (rank.get(right) ?? -1) > (rank.get(left) ?? -1) ? right : left;
}

/** Move a draft's idea history to the series created from that draft. */
export function rehomeIdeaCreation(storage: LibraryStorage, draftId: string, seriesId: string) {
  const source = liveCreationForScope(storage, 'DRAFT', draftId);
  if (!source) return;

  const sourceId = text(source.id);
  const target = liveCreationForScope(storage, 'SERIES', seriesId);
  const timestamp = now();
  if (!target) {
    storage.db
      .prepare(
        `UPDATE creations
        SET source_scope_kind = 'SERIES', source_scope_id = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(seriesId, timestamp, sourceId);
    storage.recordChange('CREATION', sourceId, 'REHOME_IDEA_SCOPE', {
      from: { kind: 'DRAFT', id: draftId },
      to: { kind: 'SERIES', id: seriesId },
    });
    return;
  }

  const targetId = text(target.id);
  let nextSortOrder = Number(
    storage.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1
        FROM creation_elements WHERE creation_id = ? AND deleted_at IS NULL`,
      )
      .pluck()
      .get(targetId),
  );
  const sourceElements = storage.db
    .prepare(
      `SELECT * FROM creation_elements
      WHERE creation_id = ? AND deleted_at IS NULL
      ORDER BY sort_order, created_at, id`,
    )
    .all(sourceId) as JsonMap[];
  const findTargetElement = storage.db.prepare(
    `SELECT * FROM creation_elements
    WHERE creation_id = ? AND kind = ? AND target_id = ?`,
  );
  for (const element of sourceElements) {
    const existing = findTargetElement.get(targetId, element.kind, element.target_id) as JsonMap | undefined;
    if (!existing) {
      storage.db
        .prepare('UPDATE creation_elements SET creation_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
        .run(targetId, nextSortOrder++, timestamp, element.id);
      continue;
    }
    if (existing.deleted_at != null) {
      storage.db
        .prepare(
          `UPDATE creation_elements
          SET payload_json = ?, sort_order = ?, updated_at = ?, deleted_at = NULL
          WHERE id = ?`,
        )
        .run(element.payload_json, nextSortOrder++, timestamp, existing.id);
    }
    storage.db
      .prepare('UPDATE creation_elements SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, element.id);
  }

  let nextSequence = Number(
    storage.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 FROM creation_activity_events WHERE creation_id = ?')
      .pluck()
      .get(targetId),
  );
  const sourceEvents = storage.db
    .prepare(
      `SELECT id FROM creation_activity_events
      WHERE creation_id = ? ORDER BY created_at, sequence, id`,
    )
    .all(sourceId) as JsonMap[];
  const moveEvent = storage.db.prepare(
    'UPDATE creation_activity_events SET creation_id = ?, sequence = ? WHERE id = ?',
  );
  for (const event of sourceEvents) moveEvent.run(targetId, nextSequence++, event.id);

  const status = strongestStatus(text(target.status), text(source.status));
  const updatedAt =
    text(target.updated_at).localeCompare(text(source.updated_at)) >= 0
      ? text(target.updated_at)
      : text(source.updated_at);
  storage.db
    .prepare(
      `UPDATE creations
      SET status = ?, failure_message = CASE WHEN ? IN ('ACTIVE', 'FORMING') THEN '' ELSE failure_message END,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(status, status, updatedAt, targetId);
  storage.db
    .prepare('UPDATE creations SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(timestamp, timestamp, sourceId);
  storage.recordChange('CREATION', targetId, 'MERGE_SCOPE', {
    mergedCreationId: sourceId,
    from: { kind: 'DRAFT', id: draftId },
    to: { kind: 'SERIES', id: seriesId },
  });
  storage.recordChange('CREATION', sourceId, 'DELETE_AFTER_MERGE', { targetCreationId: targetId });
}

/** Ideas belong to their source creation and leave the active library with it. */
export function archiveIdeasForSeries(storage: LibraryStorage, seriesId: string, timestamp = now()) {
  const rows = storage.db
    .prepare(
      `SELECT id FROM creations
      WHERE source_scope_kind = 'SERIES' AND source_scope_id = ?
        AND deleted_at IS NULL AND status <> 'ARCHIVED'`,
    )
    .all(seriesId) as JsonMap[];
  storage.db
    .prepare(
      `UPDATE creations
      SET status = 'ARCHIVED', archived_at = ?, updated_at = ?
      WHERE source_scope_kind = 'SERIES' AND source_scope_id = ?
        AND deleted_at IS NULL AND status <> 'ARCHIVED'`,
    )
    .run(timestamp, timestamp, seriesId);
  for (const row of rows) storage.recordChange('CREATION', text(row.id), 'ARCHIVE_WITH_SERIES', { seriesId });
}
