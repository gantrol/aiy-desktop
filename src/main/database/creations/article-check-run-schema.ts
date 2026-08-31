import type Database from 'better-sqlite3';
import articleCheckRunsSql from '@/main/database/sql/v03-revision-005-article-check-runs.sql?raw';

export type ArticleCheckRunStorageShape = 'ABSENT' | 'COMPLETE';

function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

function tableNames(db: Database.Database) {
  return new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

function columnNames(db: Database.Database, table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

export function articleCheckRunStorageShape(db: Database.Database): ArticleCheckRunStorageShape {
  if (!tableNames(db).has('article_check_runs')) return 'ABSENT';
  const columns = columnNames(db, 'article_check_runs');
  const required = [
    'id',
    'article_id',
    'input_revision_id',
    'article_title',
    'locale',
    'provider_key',
    'requested_model',
    'reasoning_effort',
    'status',
    'finding_count',
    'result_json',
    'comment_ids_json',
    'error_code',
    'error_message',
    'started_at',
    'finished_at',
    'applied_at',
  ];
  if (!required.every((column) => columns.has(column))) unsupportedSchema();
  const indexes = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'article_check_runs'")
        .all() as Array<{ name: string }>
    ).map((index) => index.name),
  );
  if (
    !indexes.has('idx_article_check_runs_started') ||
    !indexes.has('idx_article_check_runs_article_started') ||
    !indexes.has('idx_article_check_runs_active_article')
  ) {
    unsupportedSchema();
  }
  return 'COMPLETE';
}

export function ensureArticleCheckRuns(db: Database.Database) {
  if (articleCheckRunStorageShape(db) === 'ABSENT') db.exec(articleCheckRunsSql);
}
