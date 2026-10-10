import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';
import { initializeDatabaseSchema, markDatabaseCleanShutdown } from '@/main/database/core/schema';

// SQLite and JSON conversion run before the library becomes available to the UI.
const db = new Database(String(workerData), { fileMustExist: true });
try {
  const result = initializeDatabaseSchema(db);
  markDatabaseCleanShutdown(db);
  parentPort?.postMessage(result);
} finally {
  db.close();
}
