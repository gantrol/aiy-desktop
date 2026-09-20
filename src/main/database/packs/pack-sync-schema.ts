import type Database from 'better-sqlite3';
import { columnNames } from '@/main/database/core/schema-inspection';

export function packSyncSchemaComplete(db: Database.Database) {
  const columns = columnNames(db, 'pack_sync_runs');
  return ['id', 'kind', 'status', 'started_at', 'finished_at', 'items_json'].every((column) => columns.has(column));
}

export function ensurePackSyncSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS pack_sync_runs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('BUILTIN','CONTENT_PACK')),
    status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','INTERRUPTED')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    items_json TEXT NOT NULL CHECK(json_valid(items_json)),
    CHECK((status='RUNNING') = (finished_at IS NULL))
  );`);
  if (!packSyncSchemaComplete(db)) throw new Error('Pack sync schema is incomplete');
}
