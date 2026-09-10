import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-social-post-saves.sql?raw';

export function socialPostSaveShape(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(social_post_save_receipts)').all() as { name: string }[];
  if (!columns.length) return 'ABSENT';
  return ['request_id', 'request_hash', 'post_id', 'revision_id', 'created_revision'].every((name) =>
    columns.some((column) => column.name === name),
  )
    ? 'COMPLETE'
    : 'PARTIAL';
}
export function ensureSocialPostSaves(db: Database.Database) {
  const shape = socialPostSaveShape(db);
  if (shape === 'PARTIAL') throw new Error('Social post save schema is incomplete');
  if (shape === 'ABSENT') db.exec(sql);
}
