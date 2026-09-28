import type Database from 'better-sqlite3';
import { columnNames } from '@/main/database/core/schema-inspection';
import sql from '@/main/database/sql/v03-revision-008-creation-organization.sql?raw';

export function creationOrganizationSchemaComplete(db: Database.Database) {
  const parents = columnNames(db, 'creation_item_parents');
  const notes = columnNames(db, 'album_notes');
  return (
    ['creation_item_id', 'parent_creation_item_id', 'sort_order', 'updated_at'].every((key) => parents.has(key)) &&
    ['album_id', 'article_id'].every((key) => notes.has(key))
  );
}

export function ensureCreationOrganizationSchema(db: Database.Database) {
  db.exec(sql);
}
