import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-unified-content.sql?raw';
import { columnNames } from '@/main/database/core/schema-inspection';

export function unifiedContentShape(db: Database.Database) {
  return (
    columnNames(db, 'content_block_references').has('snapshot_json') &&
    columnNames(db, 'readable_content_assets').has('asset_id') &&
    columnNames(db, 'readable_content_jobs').has('generation') &&
    columnNames(db, 'readable_content_files').has('files_json') &&
    columnNames(db, 'content_editor_drafts').has('draft_json') &&
    columnNames(db, 'desktop_note_drafts').has('document_json')
  );
}
export function ensureUnifiedContentSchema(db: Database.Database) {
  db.exec(sql);
}
