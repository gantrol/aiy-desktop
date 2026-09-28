import type Database from 'better-sqlite3';
import { columnNames } from '@/main/database/core/schema-inspection';
import sql from '@/main/database/sql/v03-revision-008-publishing-masks.sql?raw';

export function publishingMaskSchemaComplete(db: Database.Database) {
  const columns = columnNames(db, 'publishing_mask_drafts');
  return ['id', 'article_id', 'social_post_id', 'platform', 'format', 'version', 'draft_json', 'updated_at'].every(
    (column) => columns.has(column),
  );
}

export function ensurePublishingMaskSchema(db: Database.Database) {
  db.exec(sql);
}
