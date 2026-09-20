import type Database from 'better-sqlite3';
import type { CalendarQueryInput } from '@/shared/contracts/calendar';
import { calendarCategorySql, CalendarSourceReader } from '@/main/database/calendar/calendar-sources';
import { calendarDateRangeEpochs, calendarNextDate } from '@/main/database/calendar/calendar-time';
import { calendarAsOfCtes } from '@/main/database/calendar/calendar-as-of';
import { calendarActivityObjects } from '@/main/database/calendar/calendar-object-sources';
import { calendarVisibleActivitySql } from '@/main/database/calendar/calendar-activity-visibility';

export interface CalendarReadFilter {
  startDate: string;
  endDate: string;
  timeZone: string;
  categories: string[];
  timeAxis: 'effective' | 'recorded';
  includeInvalidated: boolean;
  knownAt?: string | null;
}

export interface CalendarReadRow {
  id: string;
  source: 'activity' | 'activity_correction';
  category: string;
  item_revision: number;
  sort_at: string;
  invalidated: number;
  occurrence_id: string;
  entity_type: string | null;
  entity_id: string | null;
  operation: string | null;
  occurred_at: string | null;
  file_recorded_at: string | null;
  note: string | null;
  display_date: string | null;
  updated_at: string | null;
  current_revision: number;
  activity_count?: number;
  object_type?: string | null;
  object_id?: string | null;
  first_at?: string | null;
  last_at?: string | null;
  activity_categories?: string | null;
  activity_changes?: string | null;
  group_corrected?: number;
}

export interface CalendarReadPosition {
  at: string;
  ordinal: number;
  occurrenceId: string;
}

function activityDetailsSql(
  includeDetails: boolean,
  options: {
    fileRecordedAt?: string;
    note?: string;
    displayDate?: string;
    updatedAt?: string;
    currentRevision?: string;
  } = {},
) {
  if (!includeDetails)
    return `,e.entity_type entity_type,e.entity_id entity_id,e.operation operation,${options.displayDate ?? 'NULL'} display_date`;
  return `,e.entity_type entity_type,e.entity_id entity_id,e.operation operation,e.occurred_at occurred_at,
    ${options.fileRecordedAt ?? 'NULL'} file_recorded_at,${options.note ?? 'NULL'} note,
    ${options.displayDate ?? 'NULL'} display_date,${options.updatedAt ?? 'NULL'} updated_at,
    ${options.currentRevision ?? '0'} current_revision`;
}

/** Indexed activity ranges shared by detail pagination and independent day counts. */
function rowsSql(input: CalendarReadFilter, includeDetails: boolean) {
  const events = input.knownAt ? 'calendar_known_events' : 'change_events';
  const overrides = input.knownAt ? 'calendar_known_overrides' : 'calendar_activity_overrides';
  const revisionCutoff = input.knownAt ? 'AND r.recorded_at <= @knownAt' : '';
  const fileRecordedAt = input.knownAt ? 'e.file_recorded_at' : 'f.recorded_at';
  const eventFileJoin =
    input.knownAt || !includeDetails ? '' : 'LEFT JOIN calendar_file_event_times f ON f.event_id=e.id';
  const currentOverrideJoin = includeDetails ? `LEFT JOIN ${overrides} o ON o.event_id=e.id` : '';
  if (input.timeAxis === 'recorded') {
    // Corrections and withdrawals are recorded actions in their own right.
    return `SELECT e.id,${calendarCategorySql} category,'activity' source,0 item_revision,
        e.occurred_at sort_at,0 invalidated,json_array('activity',e.id,0) occurrence_id
        ${activityDetailsSql(includeDetails, {
          fileRecordedAt,
          updatedAt: 'e.occurred_at',
          currentRevision: 'COALESCE(o.revision,0)',
        })}
      FROM ${events} e ${eventFileJoin} ${currentOverrideJoin}
      WHERE e.occurred_at >= @fromAt AND e.occurred_at < @toAt AND e.rowid <= @snapshot
        AND NOT EXISTS(SELECT 1 FROM calendar_file_event_times f WHERE f.event_id=e.id)
      UNION ALL
      SELECT e.id,${calendarCategorySql} category,'activity' source,0 item_revision,
        f.recorded_at sort_at,0 invalidated,json_array('activity',e.id,0) occurrence_id
        ${activityDetailsSql(includeDetails, {
          fileRecordedAt: 'f.recorded_at',
          updatedAt: 'f.recorded_at',
          currentRevision: 'COALESCE(o.revision,0)',
        })}
      FROM calendar_file_event_times f JOIN ${events} e ON e.id=f.event_id ${currentOverrideJoin}
      WHERE f.recorded_at >= @fromAt AND f.recorded_at < @toAt AND e.rowid <= @snapshot
      UNION ALL
      SELECT r.event_id id,${calendarCategorySql} category,'activity_correction' source,
        r.revision item_revision,r.recorded_at sort_at,r.invalidated,
        json_array('activity_correction',r.event_id,r.revision) occurrence_id
        ${activityDetailsSql(includeDetails, {
          fileRecordedAt,
          note: 'r.note',
          displayDate: 'r.display_date',
          updatedAt: 'r.recorded_at',
          currentRevision: 'COALESCE(current_override.revision,0)',
        })}
      FROM calendar_activity_override_revisions r JOIN ${events} e ON e.id=r.event_id
        ${eventFileJoin} ${includeDetails ? `LEFT JOIN ${overrides} current_override ON current_override.event_id=e.id` : ''}
      WHERE r.recorded_at >= @fromAt AND r.recorded_at < @toAt AND e.rowid <= @snapshot ${revisionCutoff}`;
  }
  return `SELECT e.id,${calendarCategorySql} category,'activity' source,
      COALESCE(o.revision,0) item_revision,e.occurred_at sort_at,COALESCE(o.invalidated,0) invalidated,
      json_array('activity',e.id,COALESCE(o.revision,0)) occurrence_id
      ${activityDetailsSql(includeDetails, {
        fileRecordedAt,
        note: 'o.note',
        displayDate: 'o.display_date',
        updatedAt: 'COALESCE(o.updated_at,e.occurred_at)',
        currentRevision: 'COALESCE(o.revision,0)',
      })}
    FROM ${events} e ${eventFileJoin} LEFT JOIN ${overrides} o ON o.event_id=e.id
    WHERE e.occurred_at >= @fromAt AND e.occurred_at < @toAt AND e.rowid <= @snapshot AND o.display_date IS NULL
    UNION ALL
    SELECT e.id,${calendarCategorySql} category,'activity' source,o.revision item_revision,
      aiy_calendar_day_start(o.display_date,@timeZone) sort_at,o.invalidated,
      json_array('activity',e.id,o.revision) occurrence_id
      ${activityDetailsSql(includeDetails, {
        fileRecordedAt,
        note: 'o.note',
        displayDate: 'o.display_date',
        updatedAt: 'o.updated_at',
        currentRevision: 'o.revision',
      })}
    FROM ${overrides} o JOIN ${events} e ON e.id=o.event_id ${eventFileJoin}
    WHERE o.display_date >= @startDate AND o.display_date <= @endDate AND e.rowid <= @snapshot`;
}

function filteredRows(input: CalendarReadFilter, snapshot: number, includeDetails = false) {
  const { fromEpoch, toEpoch } = calendarDateRangeEpochs(input.startDate, input.endDate, input.timeZone);
  const categoryParams = Object.fromEntries(input.categories.map((value, index) => [`category${index}`, value]));
  const categoryList = input.categories.map((_, index) => `@category${index}`).join(',');
  return {
    sql: `WITH ${input.knownAt ? `${calendarAsOfCtes},` : ''} rows AS (${rowsSql(input, includeDetails)}), filtered AS (
      SELECT * FROM rows WHERE category IN (${categoryList})
      AND ${calendarVisibleActivitySql}
      ${input.timeAxis === 'effective' && !input.includeInvalidated ? 'AND invalidated=0' : ''}
    )`,
    params: {
      fromAt: new Date(fromEpoch).toISOString(),
      toAt: new Date(toEpoch).toISOString(),
      snapshot,
      startDate: input.startDate,
      endDate: input.endDate,
      timeZone: input.timeZone,
      ...(input.knownAt ? { knownAt: input.knownAt } : {}),
      ...categoryParams,
    },
  };
}

function objectRows(db: Database.Database, input: CalendarReadFilter, snapshot: number, details = false) {
  const { sql, params } = filteredRows(input, snapshot, details);
  const refs = db.prepare(`${sql} SELECT DISTINCT entity_type type,entity_id id FROM filtered`).all(params) as {
    type: string;
    id: string;
  }[];
  const objects =
    input.timeAxis === 'effective'
      ? calendarActivityObjects(db, refs)
      : refs.map((ref) => ({ ...ref, objectType: ref.type, objectId: ref.id }));
  const sources = new CalendarSourceReader(db, 'availability');
  sources.prefetch(objects.map((ref) => ({ type: ref.objectType, id: ref.objectId })));
  // Filter before grouping, pagination and counting. Missing sources must not
  // consume page slots or become separate anonymous objects in the heatmap.
  const availableObjects = objects.filter((ref) => sources.read({ type: ref.objectType, id: ref.objectId }).available);
  return {
    sql: `${sql}, object_refs AS MATERIALIZED (
      SELECT json_extract(value,'$.type') type,json_extract(value,'$.id') id,
        json_extract(value,'$.objectType') object_type,json_extract(value,'$.objectId') object_id
      FROM json_each(@objects)
    ), object_activity AS ${details && input.timeAxis === 'effective' ? 'MATERIALIZED ' : ''}(
      SELECT r.*,o.object_type,o.object_id,
        ${
          input.timeAxis === 'effective'
            ? 'COALESCE(r.display_date,aiy_calendar_local_date(r.sort_at,@timeZone))'
            : 'aiy_calendar_local_date(r.sort_at,@timeZone)'
        } activity_date
      FROM filtered r JOIN object_refs o ON o.type=r.entity_type AND o.id=r.entity_id
    )`,
    params: { ...params, objects: JSON.stringify(availableObjects) },
  };
}

const readFields =
  'id,source,category,item_revision,sort_at,occurrence_id,invalidated,entity_type,entity_id,operation,occurred_at,file_recorded_at,note,display_date,updated_at,current_revision';

function groupedActivityRowsSql() {
  const identity = 'activity_date,object_type,object_id';
  return `, ranked_activity AS (
    SELECT *,ROW_NUMBER() OVER (PARTITION BY ${identity} ORDER BY sort_at DESC,item_revision DESC,occurrence_id DESC) position
    FROM object_activity
  ), activity_groups AS (
    SELECT ${identity},COUNT(*) activity_count,MIN(occurred_at) first_at,MAX(occurred_at) last_at,
      MIN(invalidated) group_invalidated,MAX(item_revision>0) group_corrected,
      json_group_array(DISTINCT category) activity_categories
    FROM object_activity GROUP BY ${identity}
  ), change_counts AS (
    SELECT ${identity},entity_type,operation,COUNT(*) change_count
    FROM object_activity GROUP BY ${identity},entity_type,operation
  ), change_groups AS (
    SELECT ${identity},json_group_array(json_object('entityType',entity_type,'operation',operation,'count',change_count)
      ORDER BY entity_type,operation) activity_changes
    FROM change_counts GROUP BY ${identity}
  ), visible_rows AS (
    SELECT ${readFields
      .split(',')
      .map((field) =>
        field === 'occurrence_id'
          ? "json_array('object-day',r.activity_date,r.object_type,r.object_id) occurrence_id"
          : field === 'invalidated'
            ? 'g.group_invalidated invalidated'
            : `r.${field}`,
      )
      .join(',')},
      g.activity_count,g.object_type,g.object_id,g.first_at,g.last_at,g.activity_categories,g.group_corrected,c.activity_changes
    FROM ranked_activity r JOIN activity_groups g USING (${identity})
      JOIN change_groups c USING (${identity}) WHERE r.position=1
  )`;
}

export function readCalendarRows(
  db: Database.Database,
  input: CalendarReadFilter,
  snapshot: number,
  limit: NonNullable<CalendarQueryInput['limit']>,
  cursor: CalendarReadPosition | null,
) {
  if (!input.categories.length) return [];
  const { sql, params } = objectRows(db, input, snapshot, true);
  const grouped = input.timeAxis === 'effective';
  return db
    .prepare(
      `${sql}${grouped ? groupedActivityRowsSql() : ''} SELECT ${readFields}
      ${grouped ? ',activity_count,object_type,object_id,first_at,last_at,activity_categories,group_corrected,activity_changes' : ''}
      FROM ${grouped ? 'visible_rows' : 'object_activity'}
    ${
      cursor
        ? `WHERE sort_at < @cursorAt OR (sort_at=@cursorAt AND (item_revision < @cursorOrdinal
      OR (item_revision=@cursorOrdinal AND occurrence_id < @cursorOccurrenceId)))`
        : ''
    }
    ORDER BY sort_at DESC,item_revision DESC,occurrence_id DESC LIMIT @limit`,
    )
    .all({
      ...params,
      limit: limit + 1,
      ...(cursor
        ? { cursorAt: cursor.at, cursorOrdinal: cursor.ordinal, cursorOccurrenceId: cursor.occurrenceId }
        : {}),
    }) as CalendarReadRow[];
}

export function readCalendarDayCounts(db: Database.Database, input: CalendarReadFilter, snapshot: number) {
  const days: string[] = [];
  for (let date = input.startDate; date <= input.endDate; date = calendarNextDate(date)) days.push(date);
  if (!input.categories.length) return days.map((date) => ({ date, total: 0 }));
  const { sql, params } = objectRows(db, input, snapshot);
  const dayParams = Object.fromEntries(days.map((date, index) => [`day${index}`, date]));
  return db
    .prepare(
      `${sql}, days(date) AS (VALUES ${days.map((_, index) => `(@day${index})`).join(',')}),
      activity_days AS (
        ${
          input.timeAxis === 'effective'
            ? 'SELECT DISTINCT activity_date date,object_type,object_id FROM object_activity'
            : 'SELECT activity_date date,id,occurrence_id FROM object_activity'
        }
      ), activity_counts AS (
        SELECT date,COUNT(*) total FROM activity_days GROUP BY date
      )
      SELECT d.date,COALESCE(a.total,0) total
      FROM days d LEFT JOIN activity_counts a ON a.date=d.date ORDER BY d.date`,
    )
    .all({ ...params, ...dayParams }) as { date: string; total: number }[];
}
