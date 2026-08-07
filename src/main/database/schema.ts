import type Database from 'better-sqlite3';
import baselineSql from './sql/v03-baseline.sql?raw';

export const DATABASE_PRODUCT_BASELINE = '0.3.0';
export const DATABASE_SCHEMA_REVISION = 1;
const DATABASE_SHUTDOWN_STATE_KEY = 'database_shutdown_state';

const requiredTables = [
  'app_meta',
  'background_jobs',
  'creation_output_imports',
  'file_projection_links',
  'local_spaces',
  'materials',
  'packs',
  'term_categories',
  'term_context_profiles',
  'term_revision_categories',
  'terms',
  'word_palette_revision_content_nodes',
  'word_palette_revisions',
] as const;

function tableNames(db: Database.Database) {
  return new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  );
}

function metadata(db: Database.Database, key: string) {
  if (!tableNames(db).has('app_meta')) return undefined;
  return db.prepare('SELECT value FROM app_meta WHERE key = ?').pluck().get(key);
}

/**
 * Cheap release-baseline gate used by every process that opens the library.
 *
 * AIY 0.3.0 is the first public release. Pre-release databases are deliberately
 * not upgraded or rewritten: callers must start with an empty library or a
 * database created from this exact baseline.
 */
export function assertDatabaseSchemaCompatible(db: Database.Database) {
  const tables = tableNames(db);
  const missing = requiredTables.filter((table) => !tables.has(table));
  if (
    missing.length > 0 ||
    metadata(db, 'product_data_baseline') !== DATABASE_PRODUCT_BASELINE ||
    Number(metadata(db, 'database_schema_revision')) !== DATABASE_SCHEMA_REVISION
  ) {
    throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
  }
}

/** Expensive whole-database validation run by the primary library initializer. */
export function verifyDatabaseIntegrity(db: Database.Database) {
  const integrity = db.prepare('PRAGMA integrity_check').pluck().get();
  if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${String(integrity)}`);
  const foreignKeyViolation = db.prepare('PRAGMA foreign_key_check').get();
  if (foreignKeyViolation) throw new Error('Database foreign-key check failed');
}

export function initializeDatabaseSchema(db: Database.Database) {
  const created = tableNames(db).size === 0;
  if (created) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => db.exec(baselineSql))();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  } else db.pragma('foreign_keys = ON');

  assertDatabaseSchemaCompatible(db);
  const previousShutdownWasClean = metadata(db, DATABASE_SHUTDOWN_STATE_KEY) === 'clean';
  db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)').run(DATABASE_SHUTDOWN_STATE_KEY, 'dirty');

  if (created || !previousShutdownWasClean) verifyDatabaseIntegrity(db);
}

export function markDatabaseCleanShutdown(db: Database.Database) {
  db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)').run(DATABASE_SHUTDOWN_STATE_KEY, 'clean');
}
