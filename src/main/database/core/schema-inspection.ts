import type Database from 'better-sqlite3';

export function tableNames(db: Database.Database) {
  return new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}
export function metadata(db: Database.Database, key: string) {
  if (!tableNames(db).has('app_meta')) return undefined;
  return db.prepare('SELECT value FROM app_meta WHERE key = ?').pluck().get(key);
}
export function columnNames(db: Database.Database, table: string) {
  return new Set(
    (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

export function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

export function assertRequiredTables(db: Database.Database, requiredTables: readonly string[]) {
  const tables = tableNames(db);
  if (requiredTables.some((table) => !tables.has(table))) unsupportedSchema();
}
