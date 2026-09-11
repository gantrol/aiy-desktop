import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-note-comments.sql?raw';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';

const tables = ['content_revision_elements', 'content_comments', 'content_comment_replies'] as const;

export function noteCommentShape(db: Database.Database) {
  const present = tableNames(db);
  if (tables.every((table) => !present.has(table))) return 'ABSENT';
  if (!tables.every((table) => present.has(table))) return 'PARTIAL';
  const indexes = new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index'
          AND name IN ('idx_content_revision_elements_form', 'idx_content_comments_form_status',
            'idx_content_comment_replies_comment')`,
        )
        .all() as Array<{ name: string }>
    ).map((index) => index.name),
  );
  const complete =
    ['form_id', 'revision_id', 'element_id', 'block_index', 'node_type', 'text_fingerprint', 'preview'].every(
      (column) => columnNames(db, 'content_revision_elements').has(column),
    ) &&
    [
      'id',
      'form_id',
      'created_revision_id',
      'status',
      'anchor_kind',
      'start_element_id',
      'start_offset',
      'end_element_id',
      'end_offset',
      'start_block_index',
      'end_block_index',
      'exact_quote',
      'prefix',
      'suffix',
      'created_preview',
      'body',
      'author_id',
      'created_at',
      'updated_at',
      'resolved_at',
    ].every((column) => columnNames(db, 'content_comments').has(column)) &&
    ['id', 'comment_id', 'body', 'author_id', 'created_at', 'updated_at'].every((column) =>
      columnNames(db, 'content_comment_replies').has(column),
    ) &&
    indexes.size === 3;
  return complete ? 'COMPLETE' : 'PARTIAL';
}

export function ensureNoteComments(db: Database.Database) {
  const shape = noteCommentShape(db);
  if (shape === 'PARTIAL') throw new Error('Content comment schema is incomplete');
  if (shape === 'ABSENT') db.exec(sql);
}
