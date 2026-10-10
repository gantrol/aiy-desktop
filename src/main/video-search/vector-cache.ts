import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { contentSearchQuery, normalizeSearchText } from '@/shared/content-search-query';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type { z } from 'zod';
import type { ImageSearchEncoder } from '@/main/image-search/encoder';
import { decodeVideoWindow, probeVideo } from '@/main/video-search/decode';
import { readVideoSearchScope, type VideoSearchSource } from '@/main/video-search/sources';
import { readTimedSearchText } from '@/main/video-search/timed-text';
import { VideoSearchRanking } from '@/main/video-search/ranking';
import { isVideoSearchBorderline, videoSearchRelevance } from '@/main/video-search/relevance';
import type { videoSearchCommandSchema } from '@/main/video-search/protocol';
import type { VideoSearchItem, VideoSearchResult } from '@/shared/contracts/video-search';
import { writeWorkerDiagnostic } from '@/main/extensions/worker-diagnostics';

type Command = z.infer<typeof videoSearchCommandSchema>;
type State = {
  id: string;
  hash: string;
  revision: string;
  stamp: string;
  nextMs: number;
  durationMs: number;
  origin: number | null;
  failed: number;
  limited: number;
  turn: number;
  pendingText: number;
};
type Entry = {
  id: string;
  documentId: string;
  startMs: number;
  endMs: number;
  kind: VideoSearchItem['kind'];
  text: string;
  vector: Buffer | null;
};

function sourcePending(state: State, source: VideoSearchSource) {
  return !state.failed && (state.revision !== source.revision || state.nextMs < state.durationMs || state.pendingText);
}

function videoCoverage(sources: VideoSearchSource[], states: State[], requestedCount?: number) {
  const total = requestedCount ?? sources.length;
  const missing = total - sources.length;
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const unavailable = missing + states.filter((state) => state.failed).length;
  const pending = states.filter((state) => sourcePending(state, sourceMap.get(state.id)!)).length;
  return {
    total,
    ready: total - unavailable - pending,
    pending,
    unavailable,
    limited: states.filter((state) => state.limited).length,
  };
}

function vectorSimilarity(vector: Buffer, query: Float32Array) {
  if (vector.byteLength !== 768 * 4 || query.length !== 768) throw new Error('UNAVAILABLE');
  // Derived vectors are written locally from Float32Array buffers. SQLite may
  // return an unaligned view; copy only that case before reading native floats.
  const values =
    vector.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(vector.buffer, vector.byteOffset, 768)
      : new Float32Array(Uint8Array.from(vector).buffer);
  let score = 0;
  for (let index = 0; index < 768; index++) score += values[index]! * query[index]!;
  if (!Number.isFinite(score)) throw new Error('UNAVAILABLE');
  return score;
}

/** Rebuildable derived data; all synchronous SQLite and vector scans stay off the main thread. */
export class VideoVectorCache {
  private db: Database.Database;
  private generation = 0;
  private session = randomUUID();
  private ranked: { snapshot: string; items: VideoSearchItem[] } | null = null;
  constructor(file: string, fingerprint: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, hash TEXT, revision TEXT, stamp TEXT,
        nextMs INTEGER DEFAULT 0, durationMs INTEGER, origin REAL, failed INTEGER DEFAULT 0, limited INTEGER DEFAULT 0, turn INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, documentId TEXT, startMs INTEGER, endMs INTEGER,
        kind TEXT, text TEXT, vector BLOB, sourcePts TEXT, timeBase TEXT);
      CREATE INDEX IF NOT EXISTS entries_source ON entries(documentId, kind);
      CREATE INDEX IF NOT EXISTS entries_pending ON entries(documentId) WHERE vector IS NULL;`);
    const signature = `${fingerprint}:video-4hz-640-pts-v1:text-1200-v1`;
    const previous = this.db.prepare("SELECT value FROM meta WHERE key='format'").get() as
      { value: string } | undefined;
    if (previous?.value !== signature)
      this.db.transaction(() => {
        this.db.exec('DELETE FROM entries; DELETE FROM sources;');
        this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('format',?)").run(signature);
      })();
  }
  close() {
    this.ranked = null;
    this.db.close();
  }

  private async file(root: string, source: VideoSearchSource) {
    if (path.isAbsolute(source.relativePath)) throw new Error('UNAVAILABLE');
    const resolved = path.resolve(root, source.relativePath);
    const lexical = path.relative(root, resolved);
    if (!lexical || lexical.startsWith('..') || path.isAbsolute(lexical)) throw new Error('UNAVAILABLE');
    const candidate = await realpath(resolved);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('UNAVAILABLE');
    const info = await stat(candidate);
    if (!info.isFile() || !info.size) throw new Error('UNAVAILABLE');
    return { path: candidate, stamp: `${info.size}:${info.mtimeMs}` };
  }

  private states(sources: VideoSearchSource[]) {
    return this.db
      .prepare(
        `SELECT s.*, EXISTS (
      SELECT 1 FROM entries e WHERE e.documentId=s.id AND e.vector IS NULL
    ) AS pendingText FROM sources s WHERE s.id IN (SELECT value FROM json_each(?)) ORDER BY s.id`,
      )
      .all(JSON.stringify(sources.map((source) => source.id))) as State[];
  }

  private synchronizeSource(
    product: Database.Database,
    source: VideoSearchSource,
    state: State | undefined,
    file: { stamp: string } | null,
    prepareText: boolean,
  ) {
    const changed = !state || state.hash !== source.hash || (file && state.stamp !== file.stamp);
    if (!changed && state?.revision === source.revision) return false;
    // Invalidate stale evidence immediately, but parse only one document's text per request.
    const text = prepareText ? readTimedSearchText(product, source.id) : null;
    this.db.transaction(() => {
      if (changed) {
        this.db.prepare('DELETE FROM entries WHERE documentId=?').run(source.id);
        this.db
          .prepare('INSERT OR REPLACE INTO sources (id,hash,revision,stamp,durationMs) VALUES (?,?,?,?,?)')
          .run(source.id, source.hash, '', file?.stamp ?? '', Math.max(1, source.durationMs));
      } else this.db.prepare("DELETE FROM entries WHERE documentId=? AND kind!='FRAME'").run(source.id);
      if (!text) return;
      const insert = this.db.prepare(
        'INSERT INTO entries (id,documentId,startMs,endMs,kind,text) VALUES (?,?,?,?,?,?)',
      );
      for (const item of text.items)
        insert.run(`${source.id}:${item.id}`, source.id, item.startMs, item.endMs, item.kind, item.text);
      this.db
        .prepare('UPDATE sources SET revision=?,limited=? WHERE id=?')
        .run(source.revision, Number(text.limited), source.id);
    })();
    this.generation++;
    return Boolean(text);
  }

  private async synchronize(product: Database.Database, sources: VideoSearchSource[], root: string, check: () => void) {
    const states = new Map(this.states(sources).map((state) => [state.id, state]));
    let preparedText = false;
    for (let offset = 0; offset < sources.length; offset += 4) {
      check();
      const files = await Promise.all(
        sources.slice(offset, offset + 4).map(async (source) => ({
          source,
          file: await this.file(root, source).catch(() => null),
        })),
      );
      for (const { source, file } of files) {
        check();
        const prepared = this.synchronizeSource(product, source, states.get(source.id), file, !preparedText);
        preparedText ||= prepared;
        if (!file) this.db.prepare('UPDATE sources SET failed=1 WHERE id=?').run(source.id);
      }
    }
  }

  private async advance(
    command: Command,
    sources: VideoSearchSource[],
    root: string,
    encoder: ImageSearchEncoder,
    check: () => void,
  ) {
    const states = this.states(sources);
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    if (command.input.retryUnavailable) {
      this.db
        .prepare('UPDATE sources SET failed=0 WHERE id IN (SELECT value FROM json_each(?))')
        .run(JSON.stringify(sources.map((s) => s.id)));
      states.forEach((state) => {
        state.failed = 0;
      });
    }
    const pendingText = this.db.prepare('SELECT * FROM entries WHERE documentId=? AND vector IS NULL LIMIT 1');
    const pending = states
      .filter(
        (state) =>
          !state.failed &&
          state.revision === sourceMap.get(state.id)?.revision &&
          (state.nextMs < state.durationMs || state.pendingText),
      )
      .sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id));
    const state = pending[0];
    if (!state) return;
    const source = sources.find((item) => item.id === state.id)!;
    this.db.prepare('UPDATE sources SET turn=turn+1 WHERE id=?').run(state.id);
    try {
      const text = pendingText.get(state.id) as Entry | undefined;
      // Alternate text and frames so long transcripts cannot starve visual indexing.
      if (text && (state.turn % 2 === 0 || state.nextMs >= state.durationMs)) {
        const vector = await encoder.document(source.title, text.text);
        check();
        this.db.prepare('UPDATE entries SET vector=? WHERE id=?').run(Buffer.from(vector.buffer), text.id);
      } else {
        const file = await this.file(root, source);
        if (file.stamp !== state.stamp) throw new Error('CHANGED');
        const probe =
          state.origin === null
            ? await probeVideo(command.ffprobe, file.path, check)
            : { origin: state.origin, durationMs: state.durationMs };
        const frames = await decodeVideoWindow(command.ffmpeg, file.path, state.nextMs, probe.origin, check);
        const encoded: (Awaited<ReturnType<typeof decodeVideoWindow>>[number] & {
          id: string;
          vector: Float32Array;
        })[] = [];
        for (const frame of frames) {
          check();
          const id = `${source.id}:${source.hash}:${frame.sourcePts}:${frame.timeBase}`;
          if (this.db.prepare('SELECT 1 FROM entries WHERE id=?').get(id)) continue;
          const vector = await encoder.videoFrame(frame.pixels, 640, 640, check);
          encoded.push({ ...frame, id, vector });
        }
        check();
        if ((await this.file(root, source)).stamp !== file.stamp) throw new Error('CHANGED');
        this.db.transaction(() => {
          const insert = this.db.prepare("INSERT OR IGNORE INTO entries VALUES (?,?,?,?,?,'',?,?,?)");
          for (const frame of encoded)
            insert.run(
              frame.id,
              source.id,
              frame.timestampMs,
              frame.timestampMs,
              'FRAME',
              Buffer.from(frame.vector.buffer),
              frame.sourcePts,
              frame.timeBase,
            );
          this.db
            .prepare('UPDATE sources SET nextMs=?,durationMs=?,origin=? WHERE id=?')
            .run(Math.min(state.nextMs + 1000, probe.durationMs), probe.durationMs, probe.origin, source.id);
        })();
      }
      this.generation++;
    } catch (error) {
      if (error instanceof Error && ['CANCELLED', 'CHANGED', 'GPU_UNAVAILABLE'].includes(error.message)) throw error;
      this.db.prepare('UPDATE sources SET failed=1 WHERE id=?').run(source.id);
      this.generation++;
    }
  }

  async search(
    command: Command,
    getEncoder: () => Promise<ImageSearchEncoder>,
    check: () => void,
  ): Promise<VideoSearchResult> {
    const started = performance.now();
    const product = new Database(command.databasePath, { readonly: true, fileMustExist: true });
    try {
      const sources = await readVideoSearchScope(product, command.input.documentIds, check);
      const identities = JSON.stringify(sources);
      const root = await realpath(command.libraryRoot);
      await this.synchronize(product, sources, root, check);
      if (command.input.advanceIndex && !command.input.offset && sources.length)
        await this.advance(command, sources, root, await getEncoder(), check);
      const selected = JSON.stringify(sources.map((source) => source.id));
      const count = (sql: string) => (this.db.prepare(sql).get(selected) as { n: number }).n;
      const indexedFrames = count(
        "SELECT count(*) AS n FROM entries WHERE kind='FRAME' AND documentId IN (SELECT value FROM json_each(?))",
      );
      const states = this.states(sources);
      const sourceMap = new Map(sources.map((source) => [source.id, source]));
      const snapshot = createHash('sha256')
        .update(
          JSON.stringify([this.session, identities, states, this.generation, command.input.query, command.input.mode]),
        )
        .digest('hex');
      // Reuse only the last bounded ranking. Identity, file stamps, revisions,
      // indexing progress and query mode are rechecked before every cache hit.
      let candidates = this.ranked?.snapshot === snapshot ? this.ranked.items : undefined;
      const rankingStarted = performance.now();
      const reused = Boolean(candidates);
      let scanned = 0;
      let vectorBytes = 0;
      if (!candidates) {
        this.ranked = null;
        const haveVectors =
          count(
            'SELECT count(*) AS n FROM entries WHERE vector IS NOT NULL AND documentId IN (SELECT value FROM json_each(?))',
          ) > 0;
        const queryVector = haveVectors ? await (await getEncoder()).query(command.input.query) : null;
        check();
        const ranking = new VideoSearchRanking(command.input.mode === 'HYBRID');
        const words = command.input.mode === 'HYBRID' ? contentSearchQuery(command.input.query).terms : [];
        const read = this.db.prepare(
          'SELECT * FROM entries WHERE id>? AND documentId IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 128',
        );
        let after = '';
        for (;;) {
          check();
          const rows = read.all(after, selected) as Entry[];
          if (!rows.length) break;
          scanned += rows.length;
          for (const row of rows) {
            vectorBytes += row.vector?.byteLength ?? 0;
            const text = normalizeSearchText(row.text);
            const lexical =
              row.kind !== 'FRAME' && words.length && words.every((word) => text.includes(word)) ? words.length : 0;
            const score = row.vector && queryVector ? vectorSimilarity(row.vector, queryVector) : -1;
            if (score === -1 && !(command.input.mode === 'HYBRID' && lexical)) continue;
            const source = sourceMap.get(row.documentId)!;
            const item = {
              id: row.id,
              documentId: row.documentId,
              sourceHash: source.hash,
              revision: source.revision,
              title: source.title,
              startMs: row.startMs,
              endMs: row.endMs,
              kind: row.kind,
              preview: row.text.slice(0, 1000),
              score,
              borderline: isVideoSearchBorderline(score, row.kind),
              lexicalMatch: false,
            };
            ranking.add(item, Boolean(row.vector && queryVector), lexical);
          }
          after = rows.at(-1)!.id;
          await setImmediate();
        }
        candidates = ranking.results();
        this.ranked = { snapshot, items: candidates };
      }
      writeWorkerDiagnostic('video-search-ranked', {
        preparationMs: Math.round(rankingStarted - started),
        rankingMs: Math.round(performance.now() - rankingStarted),
        reused,
        scanned,
        vectorBytes,
      });
      check();
      if (identities !== JSON.stringify(await readVideoSearchScope(product, command.input.documentIds, check)))
        throw new Error('CHANGED');
      const coverage = videoCoverage(sources, states, command.input.documentIds?.length);
      const reset = Boolean(command.input.offset && command.input.snapshot !== snapshot);
      const offset = reset ? 0 : command.input.offset;
      return {
        scope: 'CURRENT_SAVED_DOCUMENTS',
        snapshot,
        reset,
        coverage,
        items: candidates.slice(offset, offset + 30),
        nextOffset: !coverage.pending && candidates.length > offset + 30 && offset < 990 ? offset + 30 : null,
        indexedFrames,
        processedMs: states.reduce((sum, state) => sum + state.nextMs, 0),
        totalMs: states.reduce((sum, state) => sum + state.durationMs, 0),
        relevance: videoSearchRelevance(candidates),
      };
    } finally {
      product.close();
    }
  }
}
