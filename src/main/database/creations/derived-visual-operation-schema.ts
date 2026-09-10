import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-derived-visual-operations.sql?raw';
import {
  articleVisualPositionShape,
  ensureArticleVisualPositions,
} from '@/main/database/creations/article-visual-position-schema';

const required = [
  'sequence',
  'request_id',
  'request_hash',
  'request_json',
  'visual_id',
  'kind',
  'status',
  'target_kind',
  'target_id',
  'before_revision_id',
  'result_revision_id',
  'observed_revision_id',
  'conflict_reason',
  'before_visual_json',
  'after_visual_json',
  'undone_by_request_id',
  'created_at',
  'finished_at',
];
export function derivedVisualOperationShape(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(derived_visual_operations)').all() as { name: string }[];
  if (!columns.length) return 'ABSENT';
  if (!required.every((name) => columns.some((column) => column.name === name))) return 'PARTIAL';
  const definitions = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name = 'derived_visual_operations'")
    .all() as { name: string; sql: string | null }[];
  const table = definitions.find((item) => item.name === 'derived_visual_operations')?.sql?.replace(/\s+/g, ' ');
  const pending = definitions
    .find((item) => item.name === 'idx_derived_visual_operations_pending')
    ?.sql?.replace(/\s+/g, ' ');
  return table?.includes('request_id TEXT NOT NULL UNIQUE') &&
    table.includes('sequence INTEGER PRIMARY KEY AUTOINCREMENT') &&
    pending?.includes('CREATE UNIQUE INDEX') &&
    pending.includes("(visual_id) WHERE status = 'PENDING'") &&
    ['idx_derived_visual_operations_visual', 'idx_derived_visual_operations_target'].every((name) =>
      definitions.some((item) => item.name === name),
    )
    ? 'COMPLETE'
    : 'PARTIAL';
}
export function ensureDerivedVisualOperations(db: Database.Database) {
  const shape = derivedVisualOperationShape(db);
  if (shape === 'PARTIAL') throw new Error('Derived visual operation schema is incomplete');
  if (shape === 'ABSENT') db.exec(sql);
}

export function derivedVisualStorageComplete(db: Database.Database) {
  return derivedVisualOperationShape(db) === 'COMPLETE' && articleVisualPositionShape(db) === 'COMPLETE';
}

export function ensureDerivedVisualStorage(db: Database.Database) {
  ensureDerivedVisualOperations(db);
  ensureArticleVisualPositions(db);
}
