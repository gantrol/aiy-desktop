import type Database from 'better-sqlite3';
import { columnNames } from '@/main/database/core/schema-inspection';
import sql from '@/main/database/sql/v03-revision-008-reference-history.sql?raw';

export function referenceHistoryShape(db: Database.Database) {
  const columns = columnNames(db, 'article_reference_history');
  return ['revision_id', 'resolution_id', 'state'].every((name) => columns.has(name));
}
export function ensureReferenceHistorySchema(db: Database.Database) {
  db.exec(sql);
}
