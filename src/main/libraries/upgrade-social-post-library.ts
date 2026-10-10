import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { tableNames } from '@/main/database/core/schema-inspection';
import { socialPostArticleShape } from '@/main/database/creations/social-post-article-schema';
import type { DatabaseStartupCheck } from '@/main/database/core/database-shutdown-state';

/** Back up the committed WAL snapshot, then perform the one-time upgrade off the main thread. */
export async function upgradeSocialPostLibrary(db: Database.Database): Promise<DatabaseStartupCheck | null> {
  if (!db.name || db.name === ':memory:') return null;
  const tables = tableNames(db);
  if (tables.has('app_meta') && socialPostArticleShape(db)) return null;
  if (tables.has('social_post_drafts') && db.prepare('SELECT 1 FROM social_post_drafts LIMIT 1').get())
    await db.backup(`${db.name}.before-social-post-articles-${randomUUID()}.sqlite3`, { progress: () => 128 });
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'database-upgrade-worker.js'), { workerData: db.name });
    let result: DatabaseStartupCheck | undefined;
    worker.once('message', (value: DatabaseStartupCheck) => {
      result = value;
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0 || !result) reject(new Error('Database upgrade did not complete'));
      else resolve(result);
    });
  });
}
