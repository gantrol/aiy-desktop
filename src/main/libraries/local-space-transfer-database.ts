import Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { LocalSpaceDatabaseFingerprint } from '@/main/libraries/local-space-migration-database';
import { verifyLocalSpaceDatabase } from '@/main/libraries/local-space-migration-database';

export async function createLocalSpaceDatabaseSnapshot(options: {
  database: Database.Database;
  destinationPath: string;
  signal: AbortSignal;
  report(progress: number): void;
}): Promise<LocalSpaceDatabaseFingerprint> {
  const { database, destinationPath, signal, report } = options;
  signal.throwIfAborted();
  try {
    await database.backup(destinationPath, {
      progress(info) {
        signal.throwIfAborted();
        const completedPages = Math.max(0, info.totalPages - info.remainingPages);
        report(info.totalPages ? completedPages / info.totalPages : 0);
        return 256;
      },
    });
    signal.throwIfAborted();
    const snapshot = new Database(destinationPath, { fileMustExist: true });
    try {
      snapshot.pragma('journal_mode = DELETE');
      snapshot.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('database_shutdown_state', 'clean')").run();
    } finally {
      snapshot.close();
    }
    report(1);
    return verifyLocalSpaceDatabase(path.dirname(destinationPath), 'DESTINATION', signal);
  } catch (error) {
    await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
