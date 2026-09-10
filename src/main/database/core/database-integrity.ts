import Database from 'better-sqlite3';

// Bound the address space used by the full scan; pages share the OS file cache.
const integrityCheckMmapBytes = 1024 * 1024 * 1024;

export function verifyDatabaseForeignKeys(db: Database.Database) {
  const foreignKeyViolation = db.prepare('PRAGMA foreign_key_check').get();
  if (foreignKeyViolation) throw new Error('Database foreign-key check failed');
}

export function verifyDatabaseRecovery(db: Database.Database) {
  // Recovery runs after committed schema/session metadata. A dedicated read-only
  // handle is faster on the measured Windows runtime and holds one snapshot for
  // both scans. In-memory databases and uncommitted changes use their own handle.
  if (!db.name || db.name === ':memory:' || db.inTransaction) return verifyDatabaseIntegrity(db, 'quick');
  const reader = new Database(db.name, { readonly: true, fileMustExist: true });
  try {
    return reader.transaction(() => verifyDatabaseIntegrity(reader, 'quick'))();
  } finally {
    reader.close();
  }
}

export function verifyDatabaseIntegrity(db: Database.Database, check: 'full' | 'quick' = 'full') {
  const previousMmapBytes = db.pragma('mmap_size', { simple: true });
  const changeMmap = typeof previousMmapBytes === 'number' && previousMmapBytes < integrityCheckMmapBytes;
  try {
    if (changeMmap) db.pragma(`mmap_size = ${integrityCheckMmapBytes}`);
    const startedAt = performance.now();
    const integrity = db
      .prepare(check === 'full' ? 'PRAGMA integrity_check' : 'PRAGMA quick_check')
      .pluck()
      .get();
    if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${String(integrity)}`);
    const integrityFinishedAt = performance.now();
    verifyDatabaseForeignKeys(db);
    return {
      integrityMs: Math.round(integrityFinishedAt - startedAt),
      foreignKeysMs: Math.round(performance.now() - integrityFinishedAt),
    };
  } finally {
    // Release the temporary mapping even on failure. Windows cannot truncate a
    // mapped database, so normal runtime and maintenance retain their settings.
    if (changeMmap) db.pragma(`mmap_size = ${previousMmapBytes}`);
  }
}
