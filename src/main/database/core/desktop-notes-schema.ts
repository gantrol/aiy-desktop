import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-desktop-notes.sql?raw';
import { columnNames } from '@/main/database/core/schema-inspection';

const requiredColumns = {
  inspiration_stash_revisions: ['id', 'stash_id', 'revision_no', 'content_json', 'content_hash', 'created_at'],
  desktop_note_instances: ['id', 'stash_id', 'color', 'icon', 'created_at', 'updated_at'],
  desktop_note_drafts: ['instance_id', 'editor_id', 'base_hash', 'text_content', 'sequence', 'updated_at'],
};

export function desktopNotesShape(db: Database.Database) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('inspiration_stash_revisions', 'desktop_note_instances', 'desktop_note_drafts')",
    )
    .all();
  if (tables.length === 0) return 'ABSENT';
  if (tables.length !== 3) return 'PARTIAL';
  const missingColumns = Object.entries(requiredColumns).flatMap(([table, columns]) => {
    const present = columnNames(db, table);
    return columns.filter((column) => !present.has(column)).map((column) => `${table}.${column}`);
  });
  if (missingColumns.length === 0) return 'COMPLETE';
  if (missingColumns.length === 1 && missingColumns[0] === 'inspiration_stash_revisions.revision_no') {
    return 'LEGACY_WITHOUT_REVISION_NO';
  }
  return 'PARTIAL';
}
export function ensureDesktopNotesSchema(db: Database.Database) {
  const shape = desktopNotesShape(db);
  if (shape === 'PARTIAL') throw new Error('Desktop note schema is incomplete');
  if (shape === 'COMPLETE') {
    if (!columnNames(db, 'desktop_note_drafts').has('document_json')) {
      db.exec("ALTER TABLE desktop_note_drafts ADD COLUMN document_json TEXT NOT NULL DEFAULT '{}'");
    }
    return;
  }
  db.transaction(() => {
    if (shape === 'LEGACY_WITHOUT_REVISION_NO') {
      db.exec(`
        ALTER TABLE inspiration_stash_revisions
          ADD COLUMN revision_no INTEGER NOT NULL DEFAULT 1 CHECK(revision_no > 0);
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY stash_id ORDER BY created_at, id) AS revision_no
          FROM inspiration_stash_revisions
        )
        UPDATE inspiration_stash_revisions
          SET revision_no = ranked.revision_no
          FROM ranked
          WHERE inspiration_stash_revisions.id = ranked.id;
        DROP INDEX IF EXISTS inspiration_stash_revisions_source;
      `);
    }
    db.exec(sql);
    if (!columnNames(db, 'desktop_note_drafts').has('document_json')) {
      db.exec("ALTER TABLE desktop_note_drafts ADD COLUMN document_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (desktopNotesShape(db) !== 'COMPLETE') throw new Error('Desktop note schema migration did not complete');
  })();
}
