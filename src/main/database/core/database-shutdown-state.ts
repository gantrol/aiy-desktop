import type Database from 'better-sqlite3';
import { verifyDatabaseIntegrity, verifyDatabaseRecovery } from '@/main/database/core/database-integrity';

export const DATABASE_SHUTDOWN_STATE_KEY = 'database_shutdown_state';

export interface DatabaseStartupCheck {
  reason: 'new-database' | 'schema-migration' | 'unverified-database' | 'unclean-shutdown' | 'clean-shutdown';
  mode: 'full' | 'quick' | 'skipped';
  integrityMs: number;
  foreignKeysMs: number;
}

/** Called after schema validation; only a completed close allows the fast path. */
export function beginDatabaseSession(
  db: Database.Database,
  schema: { created: boolean; migrated: boolean },
): DatabaseStartupCheck {
  const previousState = db.prepare('SELECT value FROM app_meta WHERE key = ?').pluck().get(DATABASE_SHUTDOWN_STATE_KEY);
  let reason: DatabaseStartupCheck['reason'] = 'clean-shutdown';
  if (schema.created) reason = 'new-database';
  else if (schema.migrated) reason = 'schema-migration';
  else if (previousState === 'dirty') reason = 'unclean-shutdown';
  else if (previousState !== 'clean') reason = 'unverified-database';
  // SQLite recovers WAL transactions when opening the connection. An interrupted
  // app session needs a structural and foreign-key scan, not an index audit.
  // New or migrated schemas retain the full UNIQUE/index consistency check.
  const mode = reason === 'clean-shutdown' ? 'skipped' : reason === 'unclean-shutdown' ? 'quick' : 'full';
  const setState = db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)');
  // A failed or interrupted full check must be retried in full on the next open.
  setState.run(DATABASE_SHUTDOWN_STATE_KEY, mode === 'full' ? 'checking-full' : 'dirty');
  const timings =
    mode === 'skipped'
      ? { integrityMs: 0, foreignKeysMs: 0 }
      : mode === 'quick'
        ? verifyDatabaseRecovery(db)
        : verifyDatabaseIntegrity(db);
  if (mode === 'full') setState.run(DATABASE_SHUTDOWN_STATE_KEY, 'dirty');
  return { reason, mode, ...timings };
}

export function markDatabaseCleanShutdown(db: Database.Database) {
  db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)').run(DATABASE_SHUTDOWN_STATE_KEY, 'clean');
}
