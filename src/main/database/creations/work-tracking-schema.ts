import type Database from 'better-sqlite3';
import { columnNames, tableNames, unsupportedSchema } from '@/main/database/core/schema-inspection';

// The work-tracking feature is retired. Keep its schema for existing library
// compatibility and preserve stored records without changing the schema revision.
const columns = {
  creation_work_tracking: [
    'creation_item_id',
    'description_form_id',
    'enabled',
    'revision',
    'kind',
    'state',
    'priority',
    'resolution',
    'duplicate_of',
    'tags_json',
    'tag_keys_json',
    'updated_at',
  ],
  creation_work_tracking_history: [
    'creation_item_id',
    'revision',
    'before_json',
    'after_json',
    'note',
    'occurred_at',
    'request_id',
    'request_json',
  ],
} as const;

export function workTrackingShape(db: Database.Database) {
  const tables = tableNames(db);
  const names = Object.keys(columns) as Array<keyof typeof columns>;
  if (names.every((name) => !tables.has(name))) return 'ABSENT';
  for (const name of names) {
    if (!tables.has(name)) unsupportedSchema();
    const existing = columnNames(db, name);
    if (!columns[name].every((column) => existing.has(column))) unsupportedSchema();
  }
  return 'COMPLETE';
}

export function ensureWorkTracking(db: Database.Database) {
  if (workTrackingShape(db) === 'COMPLETE') return;
  db.exec(`
    CREATE TABLE creation_work_tracking (
      creation_item_id TEXT PRIMARY KEY REFERENCES creation_items(id),
      description_form_id TEXT NOT NULL REFERENCES creation_forms(id),
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      revision INTEGER NOT NULL CHECK(revision > 0),
      kind TEXT CHECK(kind IN ('BUG', 'IMPROVEMENT', 'RESEARCH')),
      state TEXT NOT NULL CHECK(state IN ('TRIAGE', 'READY', 'IN_PROGRESS', 'VERIFY', 'CLOSED')),
      priority TEXT CHECK(priority IN ('HIGH', 'NORMAL', 'LOW')),
      resolution TEXT CHECK(resolution IN ('COMPLETED', 'DUPLICATE', 'NOT_PLANNED', 'NOT_REPRODUCIBLE')),
      duplicate_of TEXT REFERENCES creation_items(id),
      tags_json TEXT NOT NULL CHECK(json_valid(tags_json) AND json_type(tags_json) = 'array'),
      tag_keys_json TEXT NOT NULL CHECK(json_valid(tag_keys_json) AND json_type(tag_keys_json) = 'array'),
      updated_at TEXT NOT NULL,
      CHECK((state = 'CLOSED' AND resolution IS NOT NULL) OR (state <> 'CLOSED' AND resolution IS NULL)),
      CHECK((resolution = 'DUPLICATE' AND duplicate_of IS NOT NULL AND duplicate_of <> creation_item_id)
        OR (resolution IS NOT 'DUPLICATE' AND duplicate_of IS NULL))
    );
    CREATE INDEX idx_work_tracking_state ON creation_work_tracking(enabled, state, updated_at DESC, creation_item_id);
    CREATE TABLE creation_work_tracking_history (
      creation_item_id TEXT NOT NULL REFERENCES creation_work_tracking(creation_item_id),
      revision INTEGER NOT NULL CHECK(revision > 0),
      before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
      after_json TEXT NOT NULL CHECK(json_valid(after_json)),
      note TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      request_json TEXT NOT NULL CHECK(json_valid(request_json)),
      PRIMARY KEY(creation_item_id, revision)
    );
  `);
}
