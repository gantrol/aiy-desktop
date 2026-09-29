import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import Database from 'better-sqlite3';
import {
  FACT_BACKUP_BUFFER_BYTES,
  FACT_BACKUP_DIRECTORY,
  FACT_BACKUP_ERROR,
  FACT_BACKUP_MAX_LINE_BYTES,
  factDigest,
  factSourceSchema,
  readFactManifest,
  writeFactManifest,
  type FactGeneration,
  type FactSource,
} from '@/main/extensions/codex-usage-investigator/fact-backup-format';

export interface FactBackupOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

interface ArchiveInput extends FactBackupOptions {
  database: Database.Database;
  directory: string;
  source: FactSource;
  sourceRevision: string;
  hasTurns: boolean;
}

async function writeArchive(input: ArchiveInput): Promise<FactGeneration> {
  const { database, directory, source, sourceRevision, signal } = input;
  const file = `${factDigest(`${source.session_id}:${sourceRevision}`)}.jsonl.gz`;
  const temporary = path.join(directory, `${randomUUID()}.archive.tmp`);
  const hash = createHash('sha256');
  let events = 0;
  let turns = 0;
  function encode(value: unknown) {
    const line = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line) > FACT_BACKUP_MAX_LINE_BYTES) throw new Error('Fact backup record is too large');
    hash.update(line);
    return line;
  }
  async function* records() {
    yield encode({
      type: 'source',
      format: 'aiy.codex-usage-facts',
      version: 1,
      databaseVersion: database.pragma('user_version', { simple: true }),
      source,
    });
    for (const table of ['usage_events', ...(input.hasTurns ? ['usage_chat_turns'] : [])]) {
      const order = table === 'usage_events' ? 'event_order' : 'turn_order, turn_id';
      const rows = database.prepare(`SELECT * FROM ${table} WHERE source_session_id = ? ORDER BY ${order}`);
      let chunk = '';
      let bytes = 0;
      for (const row of rows.iterate(source.session_id)) {
        signal?.throwIfAborted();
        const line = encode({ type: table, row });
        chunk += line;
        bytes += Buffer.byteLength(line);
        if (table === 'usage_events') events++;
        else turns++;
        if (bytes < FACT_BACKUP_BUFFER_BYTES) continue;
        yield chunk;
        chunk = '';
        bytes = 0;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (chunk) yield chunk;
    }
    yield `${JSON.stringify({ type: 'end', events, turns, sha256: hash.copy().digest('hex') })}\n`;
  }
  try {
    await pipeline(
      Readable.from(records(), { objectMode: false, highWaterMark: FACT_BACKUP_BUFFER_BYTES }),
      createGzip(),
      createWriteStream(temporary, { flags: 'wx', flush: true }),
      { signal },
    );
    const bytes = (await stat(temporary)).size;
    signal?.throwIfAborted();
    await rename(temporary, path.join(directory, file));
    return {
      file,
      sourceRevision,
      sha256: hash.digest('hex'),
      events,
      turns,
      bytes,
      createdAt: new Date().toISOString(),
    };
  } finally {
    await rm(temporary, { force: true });
  }
}

/** A separate read transaction keeps each backup coherent while the app remains responsive. */
export async function backupCodexUsageFacts(databasePath: string, options: FactBackupOptions = {}) {
  const directory = path.join(path.dirname(databasePath), 'backups', FACT_BACKUP_DIRECTORY);
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5_000 });
  try {
    database.exec('BEGIN');
    const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").pluck().all());
    if (!tables.has('usage_source_files') || !tables.has('usage_events')) return { filesWritten: 0, bytesWritten: 0 };
    await mkdir(directory, { recursive: true });
    const manifest = await readFactManifest(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    const available = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const sources = database
      .prepare('SELECT * FROM usage_source_files ORDER BY session_id LIMIT 100001')
      .all()
      .map((row) => factSourceSchema.parse(row));
    if (sources.length > 100_000) throw new Error('Too many Codex usage sources to back up');
    let completed = 0;
    let filesWritten = 0;
    let bytesWritten = 0;
    let lastProgressAt = 0;
    options.onProgress?.(0, sources.length);
    for (const source of sources) {
      options.signal?.throwIfAborted();
      const key = factDigest(source.session_id);
      const existing = manifest.sources[key];
      const sourceRevision = factDigest(JSON.stringify(source));
      if (existing?.current.sourceRevision !== sourceRevision || !available.has(existing.current.file)) {
        const current = await writeArchive({
          database,
          directory,
          source,
          sourceRevision,
          hasTurns: tables.has('usage_chat_turns'),
          signal: options.signal,
        });
        const previous =
          existing && available.has(existing.current.file) && existing.current.file !== current.file
            ? existing.current
            : existing?.previous;
        manifest.sources[key] = { current, ...(previous ? { previous } : {}) };
        filesWritten++;
        bytesWritten += current.bytes;
      }
      completed++;
      if (Date.now() - lastProgressAt >= 200 || completed === sources.length) {
        options.onProgress?.(completed, sources.length);
        lastProgressAt = Date.now();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    options.signal?.throwIfAborted();
    if (filesWritten) await writeFactManifest(directory, manifest);
    // Missing sources stay in the manifest: clearing the working index cannot erase backups.
    const retained = new Set(
      Object.values(manifest.sources).flatMap(({ current, previous }) => [
        current.file,
        ...(previous ? [previous.file] : []),
      ]),
    );
    let removed = 0;
    for (const entry of entries) {
      if (removed >= 128) break;
      const ownedFile =
        /^[a-f0-9]{64}\.jsonl\.gz$/.test(entry.name) || /^[a-f0-9-]{36}\.(archive|manifest)\.tmp$/.test(entry.name);
      if (!entry.isFile() || retained.has(entry.name) || !ownedFile) continue;
      options.signal?.throwIfAborted();
      await rm(path.join(directory, entry.name));
      removed++;
    }
    return { filesWritten, bytesWritten };
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error(FACT_BACKUP_ERROR, { cause: error });
  } finally {
    database.close();
  }
}
