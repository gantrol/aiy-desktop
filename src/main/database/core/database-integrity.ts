import type Database from 'better-sqlite3';

export function verifyDatabaseForeignKeys(db: Database.Database) {
  const foreignKeyViolation = db.prepare('PRAGMA foreign_key_check').get();
  if (foreignKeyViolation) throw new Error('Database foreign-key check failed');
}

export function verifyDatabaseIntegrity(db: Database.Database) {
  const integrity = db.prepare('PRAGMA integrity_check').pluck().get();
  if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${String(integrity)}`);
  verifyDatabaseForeignKeys(db);
}
