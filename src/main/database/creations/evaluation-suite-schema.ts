import type Database from 'better-sqlite3';

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

export function evaluationSuiteShape(db: Database.Database) {
  const tables = tableNames(db);
  const suitesPresent = tables.has('evaluation_suites');
  const revisionsPresent = tables.has('evaluation_suite_revisions');
  if (!suitesPresent && !revisionsPresent) return 'ABSENT' as const;
  if (!suitesPresent || !revisionsPresent) unsupportedSchema();
  const suiteColumns = columnNames(db, 'evaluation_suites');
  const revisionColumns = columnNames(db, 'evaluation_suite_revisions');
  const suiteRequired = [
    'id',
    'album_id',
    'current_revision_id',
    'status',
    'created_at',
    'updated_at',
    'archived_at',
    'deleted_at',
  ];
  const revisionRequired = ['id', 'suite_id', 'revision_no', 'content_json', 'content_hash', 'created_at'];
  if (
    suiteRequired.every((column) => suiteColumns.has(column)) &&
    revisionRequired.every((column) => revisionColumns.has(column))
  ) {
    return 'COMPLETE' as const;
  }
  unsupportedSchema();
}
