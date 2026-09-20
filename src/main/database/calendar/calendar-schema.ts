import type Database from 'better-sqlite3';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';
import { ensureCalendarUsageIndexes } from '@/main/database/calendar/calendar-usage';
import {
  calendarEventTriggersComplete,
  ensureCalendarEventTriggers,
} from '@/main/database/calendar/calendar-event-triggers';
import {
  calendarHandoffCaptureComplete,
  ensureCalendarHandoffCaptureSchema,
} from '@/main/database/calendar/calendar-handoff-capture';
import { calendarViewsSchemaComplete, ensureCalendarViewsSchema } from '@/main/database/calendar/calendar-views';

const expectedColumns = {
  calendar_activity_overrides: [
    'event_id',
    'revision',
    'note',
    'display_date',
    'invalidated',
    'recorded_at',
    'updated_at',
  ],
  calendar_activity_override_revisions: ['event_id', 'revision', 'note', 'display_date', 'invalidated', 'recorded_at'],
  calendar_preferences: ['id', 'preferences_json'],
  calendar_state: ['id', 'revision', 'instance_id'],
} as const;

const requiredObjects = [
  'calendar_activity_overrides_date',
  'calendar_activity_override_revisions_recorded',
  'calendar_activity_override_revisions_no_update',
  'calendar_activity_override_revisions_no_delete',
  'idx_change_events_calendar_time',
  'idx_change_events_calendar_entity',
];

function requiredObjectsComplete(db: Database.Database) {
  const names = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','index')").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  return requiredObjects.every((name) => names.has(name));
}

export function calendarSchemaShape(db: Database.Database) {
  const tables = tableNames(db);
  const present = Object.keys(expectedColumns).filter((table) => tables.has(table));
  if (!present.length) return 'ABSENT' as const;
  if (
    present.length !== Object.keys(expectedColumns).length ||
    !Object.entries(expectedColumns).every(([table, required]) => {
      const actual = columnNames(db, table);
      return required.every((column) => actual.has(column) || (table === 'calendar_state' && column === 'instance_id'));
    })
  )
    return 'PARTIAL' as const;
  if (
    !columnNames(db, 'calendar_state').has('instance_id') ||
    !requiredObjectsComplete(db) ||
    !calendarHandoffCaptureComplete(db) ||
    !calendarViewsSchemaComplete(db) ||
    !calendarEventTriggersComplete(db)
  )
    return 'LEGACY' as const;
  return 'COMPLETE' as const;
}

const sql = `
CREATE TABLE calendar_activity_overrides (
  event_id TEXT PRIMARY KEY REFERENCES change_events(id), revision INTEGER NOT NULL CHECK(revision > 0),
  note TEXT NOT NULL, display_date TEXT, invalidated INTEGER NOT NULL CHECK(invalidated IN (0,1)),
  recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX calendar_activity_overrides_date ON calendar_activity_overrides(display_date, event_id);
CREATE TABLE calendar_activity_override_revisions (
  event_id TEXT NOT NULL REFERENCES change_events(id), revision INTEGER NOT NULL CHECK(revision > 0),
  note TEXT NOT NULL, display_date TEXT, invalidated INTEGER NOT NULL CHECK(invalidated IN (0,1)),
  recorded_at TEXT NOT NULL, PRIMARY KEY(event_id, revision)
);
CREATE INDEX calendar_activity_override_revisions_recorded
  ON calendar_activity_override_revisions(recorded_at,event_id,revision);
CREATE TABLE calendar_preferences (
  id INTEGER PRIMARY KEY CHECK(id=1), preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json))
);
CREATE TABLE calendar_state (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision >= 0), instance_id TEXT NOT NULL
);
INSERT INTO calendar_state(id, revision, instance_id) VALUES(1,0,lower(hex(randomblob(16))));
CREATE INDEX idx_change_events_calendar_time ON change_events(occurred_at, id);
CREATE INDEX idx_change_events_calendar_entity ON change_events(entity_type, entity_id, occurred_at, id);
CREATE TRIGGER calendar_activity_override_revisions_no_update
BEFORE UPDATE ON calendar_activity_override_revisions
BEGIN SELECT RAISE(ABORT, 'Calendar corrections are immutable'); END;
CREATE TRIGGER calendar_activity_override_revisions_no_delete
BEFORE DELETE ON calendar_activity_override_revisions
BEGIN SELECT RAISE(ABORT, 'Calendar corrections are immutable'); END;
`;

function ensureCalendarObjects(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS calendar_activity_overrides_date
      ON calendar_activity_overrides(display_date,event_id);
    CREATE INDEX IF NOT EXISTS calendar_activity_override_revisions_recorded
      ON calendar_activity_override_revisions(recorded_at,event_id,revision);
    CREATE INDEX IF NOT EXISTS idx_change_events_calendar_time ON change_events(occurred_at,id);
    CREATE INDEX IF NOT EXISTS idx_change_events_calendar_entity
      ON change_events(entity_type,entity_id,occurred_at,id);
    CREATE TRIGGER IF NOT EXISTS calendar_activity_override_revisions_no_update
    BEFORE UPDATE ON calendar_activity_override_revisions
    BEGIN SELECT RAISE(ABORT,'Calendar corrections are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS calendar_activity_override_revisions_no_delete
    BEFORE DELETE ON calendar_activity_override_revisions
    BEGIN SELECT RAISE(ABORT,'Calendar corrections are immutable'); END;
  `);
}

/** Additive migration for the activity calendar. Legacy plan/reminder tables are left untouched. */
export function ensureCalendarSchema(db: Database.Database) {
  const shape = calendarSchemaShape(db);
  if (shape === 'PARTIAL') throw new Error('Calendar schema is incomplete');
  db.transaction(() => {
    if (shape === 'ABSENT') db.exec(sql);
    if (!columnNames(db, 'calendar_state').has('instance_id')) {
      db.exec("ALTER TABLE calendar_state ADD COLUMN instance_id TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE calendar_state SET instance_id=lower(hex(randomblob(16))) WHERE instance_id=''");
    }
    ensureCalendarObjects(db);
    ensureCalendarEventTriggers(db);
    ensureCalendarUsageIndexes(db);
    ensureCalendarHandoffCaptureSchema(db);
    ensureCalendarViewsSchema(db);
    if (calendarSchemaShape(db) !== 'COMPLETE') throw new Error('Calendar migration did not complete');
  })();
}
