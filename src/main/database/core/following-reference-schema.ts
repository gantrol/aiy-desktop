import type Database from 'better-sqlite3';
import { columnNames } from '@/main/database/core/schema-inspection';
import { ensureReferenceHistorySchema, referenceHistoryShape } from '@/main/database/core/reference-history-schema';
import sql from '@/main/database/sql/v03-revision-008-following-references.sql?raw';

export function followingReferenceShape(db: Database.Database) {
  return (
    columnNames(db, 'content_following_references').has('snapshot_json') &&
    columnNames(db, 'content_reference_resolutions').has('bindings_json') &&
    columnNames(db, 'readable_content_reference_dependencies').has('reference_id') &&
    columnNames(db, 'readable_content_reference_dependencies').has('source_kind') &&
    columnNames(db, 'content_block_references').has('resolution_key') &&
    columnNames(db, 'article_delivery_jobs').has('reference_resolution_id') &&
    columnNames(db, 'article_delivery_jobs').has('resolved_content_hash') &&
    referenceHistoryShape(db)
  );
}
export function ensureFollowingReferenceSchema(db: Database.Database) {
  db.exec(sql);
  ensureReferenceHistorySchema(db);
  if (!columnNames(db, 'content_block_references').has('resolution_key'))
    db.exec('ALTER TABLE content_block_references ADD COLUMN resolution_key TEXT');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS content_reference_resolution_key ON content_block_references(resolution_key) WHERE resolution_key IS NOT NULL',
  );
  const columns = columnNames(db, 'article_delivery_jobs');
  if (!columns.has('reference_resolution_id'))
    db.exec(
      'ALTER TABLE article_delivery_jobs ADD COLUMN reference_resolution_id TEXT REFERENCES content_reference_resolutions(id)',
    );
  if (!columns.has('resolved_content_hash'))
    db.exec('ALTER TABLE article_delivery_jobs ADD COLUMN resolved_content_hash TEXT');
}
