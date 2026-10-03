import { stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { CodexOutputThroughput } from '@/shared/contracts/codex-output-throughput';
import type { CodexHistoryThroughputsInput } from '@/shared/contracts/codex-history-search';
import { readCodexOutputThroughput } from '@/main/extensions/codex-usage-investigator/output-throughput';

/** Reads retained facts only. Never opens rollouts, creates a cache or runs migrations. */
export async function readCachedThreadThroughput(
  databasePath: string | undefined,
  items: CodexHistoryThroughputsInput['threads'],
  signal: AbortSignal,
) {
  const empty = new Map<string, CodexOutputThroughput>();
  if (!databasePath || !items.length || path.resolve(databasePath).toLowerCase().includes('trash')) return empty;
  const info = await stat(databasePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  signal.throwIfAborted();
  if (!info?.isFile()) return empty;
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    // Old cache revisions are left untouched; a usage investigation upgrades them.
    const required = database
      .prepare(
        `SELECT name FROM pragma_table_info('usage_source_files') WHERE name IN ('history_retained', 'turn_metadata_complete')`,
      )
      .all();
    if (required.length !== 2) return empty;
    database.exec('BEGIN');
    const { sessions } = await readCodexOutputThroughput(database, {
      fromEpoch: null,
      toEpoch: Date.now(),
      sessionIds: items.map((item) => item.threadId),
      signal,
      updatedAfter: new Map(items.map((item) => [item.threadId, Date.parse(item.updatedAt)])),
    });
    return sessions;
  } finally {
    database.close();
  }
}
