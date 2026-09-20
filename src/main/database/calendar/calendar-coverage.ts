import type Database from 'better-sqlite3';
const nullable = (value: unknown) => (typeof value === 'string' ? value : null);

export function calendarCoverage(db: Database.Database, snapshot: number, returnedCount: number, knownAt?: string) {
  return {
    source: 'change_events' as const,
    completeness: 'partial' as const,
    firstRecordedAt: nullable(
      db
        .prepare(
          `SELECT MIN(first_at) FROM (
        SELECT MIN(e.occurred_at) first_at FROM change_events e WHERE e.rowid <= @snapshot AND e.occurred_at<=@knownAt
          AND NOT EXISTS(SELECT 1 FROM calendar_file_event_times f WHERE f.event_id=e.id)
        UNION ALL
        SELECT MIN(f.recorded_at) first_at FROM calendar_file_event_times f JOIN change_events e ON e.id=f.event_id
          WHERE e.rowid <= @snapshot AND f.recorded_at<=@knownAt
      )`,
        )
        .pluck()
        .get({ snapshot, knownAt: knownAt ?? '9998-12-31T23:59:59.999Z' }),
    ),
    gaps: [
      'activity_time_is_recorded_time',
      'unrecorded_legacy_changes',
      'petal_visibility_not_recorded',
      'job_transitions_not_recorded',
      'external_activity_not_linked',
    ],
    returnedCount,
    snapshotEventRowid: snapshot,
  };
}
