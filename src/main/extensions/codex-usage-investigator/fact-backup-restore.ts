import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  FACT_BACKUP_BUFFER_BYTES,
  FACT_BACKUP_MAX_LINE_BYTES,
  FACT_BACKUP_TABLES,
  factDigest,
  factFooterSchema,
  factHeaderSchema,
  factRecordSchema,
  readFactManifest,
  type FactGeneration,
} from '@/main/extensions/codex-usage-investigator/fact-backup-format';

function factInserter(database: Database.Database) {
  const columns = new Map(
    FACT_BACKUP_TABLES.map((table) => [
      table,
      new Set(
        z
          .array(z.object({ name: z.string() }))
          .parse(database.pragma(`table_info(${table})`))
          .map(({ name }) => name),
      ),
    ]),
  );
  const statements = new Map<string, Database.Statement>();
  return (table: (typeof FACT_BACKUP_TABLES)[number], row: Record<string, string | number | null>) => {
    const names = Object.keys(row);
    if (!names.length || names.some((name) => !columns.get(table)?.has(name)))
      throw new Error('Unsupported fact backup columns');
    const key = `${table}:${names.join(',')}`;
    let statement = statements.get(key);
    if (!statement) {
      statement = database.prepare(
        `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
      );
      statements.set(key, statement);
    }
    statement.run(...names.map((name) => row[name]));
  };
}

async function restoreArchive(
  directory: string,
  key: string,
  generation: FactGeneration,
  insert: ReturnType<typeof factInserter>,
  signal?: AbortSignal,
) {
  const hash = createHash('sha256');
  let sessionId: string | null = null;
  let events = 0;
  let turns = 0;
  let ended = false;
  let totalBytes = 0;
  function consume(line: string) {
    signal?.throwIfAborted();
    if (ended || Buffer.byteLength(line) > FACT_BACKUP_MAX_LINE_BYTES) throw new Error('Invalid fact backup record');
    const record: unknown = JSON.parse(line);
    if (sessionId === null) {
      const header = factHeaderSchema.parse(record);
      sessionId = header.source.session_id;
      if (factDigest(sessionId) !== key || factDigest(JSON.stringify(header.source)) !== generation.sourceRevision) {
        throw new Error('Fact backup source does not match the manifest');
      }
      insert('usage_source_files', {
        ...header.source,
        cache_key: `restored:${generation.sha256}`,
        history_retained: 1,
      });
    } else {
      const footer = factFooterSchema.safeParse(record);
      if (footer.success) {
        const sha256 = hash.digest('hex');
        if (
          footer.data.sha256 !== sha256 ||
          sha256 !== generation.sha256 ||
          footer.data.events !== events ||
          footer.data.turns !== turns ||
          events !== generation.events ||
          turns !== generation.turns
        ) {
          throw new Error('Fact backup checksum or record count does not match');
        }
        ended = true;
        return;
      }
      const parsed = factRecordSchema.parse(record);
      if (parsed.row.source_session_id !== sessionId) throw new Error('Fact backup contains another source');
      insert(parsed.type, parsed.row);
      if (parsed.type === 'usage_events') events++;
      else turns++;
    }
    hash.update(`${line}\n`);
  }
  await pipeline(
    createReadStream(path.join(directory, generation.file)),
    createGunzip(),
    async (chunks) => {
      let pending = Buffer.alloc(0);
      for await (const chunk of chunks) {
        signal?.throwIfAborted();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        totalBytes += bytes.length;
        if (totalBytes > 512 * 1024 * 1024) throw new Error('Fact backup source is too large');
        pending = Buffer.concat([pending, bytes]);
        let boundary = pending.indexOf(10);
        while (boundary >= 0) {
          consume(pending.subarray(0, boundary).toString('utf8'));
          pending = pending.subarray(boundary + 1);
          boundary = pending.indexOf(10);
        }
        if (pending.length > FACT_BACKUP_MAX_LINE_BYTES) throw new Error('Fact backup record is too large');
        if (totalBytes % FACT_BACKUP_BUFFER_BYTES < bytes.length)
          await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (pending.length || !ended) throw new Error('Fact backup is incomplete');
    },
    { signal },
  );
  return { events, turns };
}

/** Rebuild an empty working index; a failed or cancelled restore rolls back every imported source. */
export async function restoreCodexUsageFacts(directory: string, database: Database.Database, signal?: AbortSignal) {
  if (database.prepare('SELECT 1 FROM usage_source_files LIMIT 1').get())
    throw new Error('Restore requires an empty Codex usage index');
  const manifest = await readFactManifest(directory);
  const entries = Object.entries(manifest.sources);
  if (!entries.length) return { sources: 0, events: 0, turns: 0 };
  if (entries.length > 100_000) throw new Error('Too many fact backup sources');
  const insert = factInserter(database);
  const restored = { sources: 0, events: 0, turns: 0 };
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, { current }] of entries) {
      const counts = await restoreArchive(directory, key, current, insert, signal);
      restored.sources++;
      restored.events += counts.events;
      restored.turns += counts.turns;
    }
    signal?.throwIfAborted();
    database.exec(`UPDATE usage_ingestion_meta SET data_revision = data_revision + 1 WHERE id = 1;
      DELETE FROM usage_processed_cache; DELETE FROM session_analysis_cache; COMMIT;`);
    return restored;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
