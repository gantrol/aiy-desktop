import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-codex-content.sql?raw';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';
const columns = {
  codex_content_preferences: ['stash_id', 'project_json'],
  codex_content_tasks: ['id', 'stash_id', 'status', 'task_json', 'input_json', 'outputs_json', 'created_at'],
};
export function codexContentShape(db: Database.Database) {
  const tables = tableNames(db);
  const present = Object.keys(columns).filter((name) => tables.has(name));
  if (!present.length) return 'ABSENT';
  const indexes = db.prepare('SELECT name, "unique", partial FROM pragma_index_list(?)').all('codex_content_tasks') as {
    name: string;
    unique: number;
    partial: number;
  }[];
  const active = indexes.find((index) => index.name === 'codex_content_tasks_active');
  const source = indexes.find((index) => index.name === 'codex_content_tasks_source');
  return present.length === 2 &&
    active?.unique === 1 &&
    active.partial === 1 &&
    !!source &&
    Object.entries(columns).every(([name, required]) => {
      const actual = columnNames(db, name);
      return required.every((column) => actual.has(column));
    })
    ? 'COMPLETE'
    : 'PARTIAL';
}
export function ensureCodexContentSchema(db: Database.Database) {
  const shape = codexContentShape(db);
  if (shape === 'COMPLETE') return;
  if (shape === 'PARTIAL') throw new Error('Codex content schema is incomplete');
  db.exec(sql);
  if (codexContentShape(db) !== 'COMPLETE') throw new Error('Codex content migration did not complete');
}
