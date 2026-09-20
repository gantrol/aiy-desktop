/**
 * Historical calendar projections over retained records. Bind @knownAt to a
 * normalized UTC instant and @snapshot to the query's change_events rowid fence.
 * Date and category filters belong after these CTEs so corrections are applied
 * before an activity is projected into a day.
 */
export const calendarAsOfCtes = `
calendar_known_events AS (
  SELECT e.rowid rowid,e.id,e.entity_type,e.entity_id,e.operation,e.occurred_at,
    e.occurred_at recorded_at,NULL file_recorded_at
  FROM change_events e
  WHERE e.rowid <= @snapshot AND e.occurred_at <= @knownAt
    AND NOT EXISTS(SELECT 1 FROM calendar_file_event_times f WHERE f.event_id=e.id)
  UNION ALL
  SELECT e.rowid rowid,e.id,e.entity_type,e.entity_id,e.operation,e.occurred_at,
    f.recorded_at recorded_at,f.recorded_at file_recorded_at
  FROM calendar_file_event_times f JOIN change_events e ON e.id=f.event_id
  WHERE e.rowid <= @snapshot AND f.recorded_at <= @knownAt
),
calendar_known_override_versions AS (
  SELECT event_id,MAX(revision) revision
  FROM calendar_activity_override_revisions WHERE recorded_at <= @knownAt GROUP BY event_id
),
calendar_known_overrides AS (
  SELECT r.event_id,r.revision,r.note,r.display_date,r.invalidated,
    COALESCE(first.recorded_at,r.recorded_at) recorded_at,r.recorded_at updated_at
  FROM calendar_known_override_versions v
  JOIN calendar_activity_override_revisions r ON r.event_id=v.event_id AND r.revision=v.revision
  JOIN calendar_known_events e ON e.id=r.event_id
  LEFT JOIN calendar_activity_override_revisions first
    ON first.event_id=r.event_id AND first.revision=1 AND first.recorded_at <= @knownAt
)`;
