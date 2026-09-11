import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-desktop-notes.sql?raw';
import noteColorsSql from '@/main/database/sql/v03-revision-006-note-colors.sql?raw';
import { columnNames } from '@/main/database/core/schema-inspection';
import { ensureNoteComments, noteCommentShape } from '@/main/database/creations/note-comment-schema';

const requiredColumns = {
  inspiration_stash_revisions: ['id', 'stash_id', 'revision_no', 'content_json', 'content_hash', 'created_at'],
  desktop_note_instances: ['id', 'stash_id', 'color', 'icon', 'created_at', 'updated_at'],
  desktop_note_drafts: ['instance_id', 'editor_id', 'base_hash', 'text_content', 'sequence', 'updated_at'],
};

function noteColorShape(db: Database.Database) {
  const definition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'desktop_note_instances'")
    .pluck()
    .get() as string;
  const colors = definition
    .match(/CHECK\s*\(\s*color\s+IN\s*\(([^)]+)\)\s*\)/i)?.[1]
    .replace(/\s/g, '')
    .split(',')
    .sort()
    .join(',');
  if (colors === "'cream','lilac','rose','sage','sky','white'" && /DEFAULT\s+'white'/i.test(definition))
    return 'COMPLETE';
  if (colors === "'cream','lilac','rose','sage','sky'") return 'LEGACY_COLORS';
  return 'PARTIAL';
}

function desktopNoteCoreShape(db: Database.Database) {
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
  if (missingColumns.length === 0) {
    const colors = noteColorShape(db);
    if (colors !== 'COMPLETE') return colors;
    return columnNames(db, 'desktop_note_drafts').has('document_json') ? 'COMPLETE' : 'LEGACY_DOCUMENT';
  }
  if (missingColumns.length === 1 && missingColumns[0] === 'inspiration_stash_revisions.revision_no') {
    return 'LEGACY_WITHOUT_REVISION_NO';
  }
  return 'PARTIAL';
}
export function desktopNotesShape(db: Database.Database) {
  const shape = desktopNoteCoreShape(db);
  return shape === 'COMPLETE' && noteCommentShape(db) !== 'COMPLETE' ? 'PARTIAL' : shape;
}
export function ensureDesktopNotesSchema(db: Database.Database) {
  const shape = desktopNoteCoreShape(db);
  if (shape === 'PARTIAL') throw new Error('Desktop note schema is incomplete');
  if (shape === 'COMPLETE') {
    ensureNoteComments(db);
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
    if (noteColorShape(db) === 'LEGACY_COLORS') {
      // The outer schema migration disables foreign keys before starting its transaction.
      // Rebuild the parent in place so drafts and other references retain their original target.
      if (db.pragma('foreign_keys', { simple: true }))
        throw new Error('Desktop note color migration requires the schema migration transaction');
      db.exec(noteColorsSql);
    }
    if (!columnNames(db, 'desktop_note_drafts').has('document_json')) {
      db.exec("ALTER TABLE desktop_note_drafts ADD COLUMN document_json TEXT NOT NULL DEFAULT '{}'");
    }
    ensureNoteComments(db);
    if (desktopNotesShape(db) !== 'COMPLETE') throw new Error('Desktop note schema migration did not complete');
  })();
}
