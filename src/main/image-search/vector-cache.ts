import Database from 'better-sqlite3';
import type { ImageSearchSource } from '@/main/database/search/image-search-sources';
import type { ImageSearchItem } from '@/shared/contracts/image-search';
import { contentSearchQuery, contentSearchSnippet, normalizeSearchText } from '@/shared/content-search-query';
import { isBorderline } from '@/main/image-search/relevance';
import { IMAGE_INPUT_POLICY } from '@/main/image-search/input-policy';
import type { ImageInputFailure, ImageInputReason } from '@/shared/contracts/image-search-issues';

const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
type CachedImage = { id: string; vector: Buffer | null };

/** Synchronous SQLite work stays in the dedicated image-search worker. */
export class ImageVectorCache {
  private readonly db: Database.Database;
  private keywordQuery: string | null = null;
  private keywordGeneration = 0;

  constructor(filePath: string, fingerprint: string) {
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, hash TEXT, title TEXT, state TEXT, vector BLOB);
      CREATE TEMP TABLE visible (id TEXT PRIMARY KEY);
      CREATE TEMP TABLE scores (id TEXT PRIMARY KEY, score REAL, exact INTEGER);
      CREATE TABLE IF NOT EXISTS ocr (id TEXT PRIMARY KEY,hash TEXT,state TEXT,text TEXT);
      CREATE TEMP TABLE lexical (id TEXT PRIMARY KEY,tier INTEGER,match TEXT,preview TEXT);
      CREATE TEMP TABLE keyword_results (position INTEGER PRIMARY KEY,id TEXT UNIQUE,match TEXT,preview TEXT);
    `);
    // This is a rebuildable cache, not a product database migration. Preserve existing image vectors.
    this.db
      .transaction(() => {
        const columns = this.db.pragma('table_info(images)') as { name: string }[];
        if (!columns.some((column) => column.name === 'aliases'))
          this.db.exec("ALTER TABLE images ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'");
        if (!columns.some((column) => column.name === 'metadata'))
          this.db.exec("ALTER TABLE images ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
        for (const table of ['images', 'ocr']) {
          const existing = this.db.pragma(`table_info(${table})`) as { name: string }[];
          if (!existing.some((column) => column.name === 'failure'))
            this.db.exec(`ALTER TABLE ${table} ADD COLUMN failure TEXT`);
          if (!existing.some((column) => column.name === 'limited'))
            this.db.exec(`ALTER TABLE ${table} ADD COLUMN limited INTEGER NOT NULL DEFAULT 0`);
          if (!existing.some((column) => column.name === 'policy'))
            this.db.exec(`ALTER TABLE ${table} ADD COLUMN policy TEXT NOT NULL DEFAULT ''`);
        }
        const policy = this.db.prepare("SELECT value FROM meta WHERE key='input-policy'").get() as
          { value: string } | undefined;
        if (policy?.value !== IMAGE_INPUT_POLICY) {
          for (const table of process.platform === 'win32' ? ['images', 'ocr'] : ['images']) {
            this.db
              .prepare(
                `UPDATE ${table} SET state='pending',failure=NULL,policy=? WHERE state IN ('unavailable','deferred')`,
              )
              .run(IMAGE_INPUT_POLICY);
          }
          this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('input-policy',?)").run(IMAGE_INPUT_POLICY);
        }
      })
      .immediate();
    const previous = this.db.prepare("SELECT value FROM meta WHERE key='model'").get() as { value: string } | undefined;
    if (fingerprint && previous?.value !== fingerprint) {
      this.db.transaction(() => {
        this.db.exec("UPDATE images SET vector=NULL,state=CASE WHEN state='ready' THEN 'pending' ELSE state END");
        this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('model',?)").run(fingerprint);
      })();
    }
  }

  startSync() {
    this.keywordQuery = null;
    this.db.exec('DELETE FROM visible');
  }
  finishSync() {
    this.db.exec('DELETE FROM images WHERE id NOT IN (SELECT id FROM visible)');
    this.db.exec('DELETE FROM ocr WHERE id NOT IN (SELECT id FROM images)');
  }
  retry() {
    this.retryChannel('images');
  }
  private retryChannel(table: 'images' | 'ocr') {
    this.db.exec(`UPDATE ${table} SET state='pending',failure=NULL WHERE state IN ('unavailable','deferred')
      AND coalesce(json_extract(failure,'$.reason'),'UNKNOWN') NOT IN
      ('UNSUPPORTED_FORMAT','BYTE_LIMIT','PIXEL_LIMIT','DIMENSION_LIMIT')`);
  }
  close() {
    this.db.close();
  }

  synchronize(items: ImageSearchSource[], updateMetadata = true) {
    if (updateMetadata) this.keywordQuery = null;
    const visible = this.db.prepare('INSERT OR IGNORE INTO visible VALUES (?)');
    const upsert = this.db
      .prepare(`INSERT INTO images (id,hash,title,state,vector,aliases,metadata) VALUES (?,?,?,?,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,title=excluded.title,aliases=excluded.aliases,metadata=excluded.metadata,
        state=CASE WHEN images.hash=excluded.hash THEN images.state ELSE excluded.state END,
        failure=CASE WHEN images.hash=excluded.hash THEN images.failure ELSE NULL END,
        limited=CASE WHEN images.hash=excluded.hash THEN images.limited ELSE 0 END,
        vector=CASE WHEN images.hash=excluded.hash THEN images.vector ELSE NULL END`);
    const upsertOcr = this.db
      .prepare(`INSERT INTO ocr (id,hash,state,text) VALUES (?,?,?,'') ON CONFLICT(id) DO UPDATE SET
      hash=excluded.hash,state=CASE WHEN ocr.hash=excluded.hash THEN ocr.state ELSE excluded.state END,
      failure=CASE WHEN ocr.hash=excluded.hash THEN ocr.failure ELSE NULL END,
      limited=CASE WHEN ocr.hash=excluded.hash THEN ocr.limited ELSE 0 END,
      text=CASE WHEN ocr.hash=excluded.hash THEN ocr.text ELSE '' END`);
    this.db.transaction(() => {
      for (const item of items) {
        visible.run(item.id);
        if (!updateMetadata) continue;
        upsert.run(
          item.id,
          item.hash,
          item.title,
          'pending',
          JSON.stringify(item.aliases),
          JSON.stringify({ titleKind: item.titleKind, createdAt: item.createdAt }),
        );
        upsertOcr.run(item.id, item.hash, process.platform === 'win32' ? 'pending' : 'unavailable');
        if (process.platform !== 'win32')
          this.db
            .prepare("UPDATE ocr SET failure=? WHERE id=? AND state='unavailable' AND failure IS NULL")
            .run(JSON.stringify({ reason: 'OCR_UNAVAILABLE', stage: 'ocr' }), item.id);
        if (!supported.has(item.mime)) {
          const failure = JSON.stringify({ reason: 'UNSUPPORTED_FORMAT', stage: 'source' });
          this.db
            .prepare("UPDATE images SET state='unavailable',failure=? WHERE id=? AND state='pending'")
            .run(failure, item.id);
          this.db
            .prepare("UPDATE ocr SET state='unavailable',failure=? WHERE id=? AND state='pending'")
            .run(failure, item.id);
        }
      }
    })();
  }

  pending() {
    return this.db
      .prepare("SELECT id,hash FROM images JOIN visible USING(id) WHERE state='pending' ORDER BY id LIMIT 4")
      .all() as { id: string; hash: string }[];
  }

  needsImage(id: string, hash: string) {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM images JOIN visible USING(id) WHERE id=? AND hash=? AND state='pending'")
        .get(id, hash),
    );
  }

  save(id: string, hash: string, vector: Float32Array | null, failure?: ImageInputFailure, limited = false) {
    this.db
      .prepare(
        "UPDATE images SET state=?,vector=?,failure=?,limited=?,policy=? WHERE id=? AND hash=? AND state='pending'",
      )
      .run(
        vector ? 'ready' : failure?.reason === 'RESOURCE_LIMIT' ? 'deferred' : 'unavailable',
        vector ? Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength) : null,
        vector ? null : JSON.stringify(failure ?? { reason: 'INDEX_FAILED', stage: 'encode' }),
        Number(limited),
        IMAGE_INPUT_POLICY,
        id,
        hash,
      );
  }

  hasVectors() {
    return Boolean(this.db.prepare("SELECT 1 FROM images JOIN visible USING(id) WHERE state='ready' LIMIT 1").get());
  }

  get generation() {
    return Number(this.db.pragma('data_version', { simple: true })) + this.ocrRevision;
  }
  private ocrRevision = 0;

  pendingOcr() {
    return this.db
      .prepare("SELECT ocr.id,ocr.hash FROM ocr JOIN visible USING(id) WHERE state='pending' ORDER BY id LIMIT 1")
      .all() as { id: string; hash: string }[];
  }

  retryOcr() {
    if (process.platform === 'win32') this.retryChannel('ocr');
  }

  unavailableOcr() {
    this.db
      .prepare("UPDATE ocr SET state='unavailable',failure=? WHERE state='pending'")
      .run(JSON.stringify({ reason: 'OCR_UNAVAILABLE', stage: 'ocr' }));
    this.ocrRevision++;
  }

  saveOcr(id: string, hash: string, text: string | null, failure?: ImageInputFailure, limited = false) {
    this.db
      .prepare("UPDATE ocr SET state=?,text=?,failure=?,limited=?,policy=? WHERE id=? AND hash=? AND state='pending'")
      .run(
        text === null ? (failure?.reason === 'RESOURCE_LIMIT' ? 'deferred' : 'unavailable') : 'ready',
        text ?? '',
        text === null ? JSON.stringify(failure ?? { reason: 'INDEX_FAILED', stage: 'ocr' }) : null,
        Number(limited),
        IMAGE_INPUT_POLICY,
        id,
        hash,
      );
    this.ocrRevision++;
  }

  private ocrCoverage() {
    return this.db
      .prepare(
        `SELECT count(*) total,coalesce(sum(state='ready'),0) ready,
      coalesce(sum(state='pending'),0) pending,coalesce(sum(state='unavailable'),0) unavailable,
      coalesce(sum(state='deferred' OR (state='ready' AND limited=1)),0) limited
      FROM ocr JOIN visible USING(id)`,
      )
      .get() as { total: number; ready: number; pending: number; unavailable: number; limited: number };
  }

  private channelCoverage(table: 'images' | 'ocr') {
    const counts = this.db
      .prepare(
        `SELECT count(*) total,coalesce(sum(state='ready'),0) ready,
      coalesce(sum(state='pending'),0) pending,coalesce(sum(state='unavailable'),0) unavailable,
      coalesce(sum(state='deferred'),0) deferred,coalesce(sum(state='ready' AND limited=1),0) limited
      FROM ${table} JOIN visible USING(id)`,
      )
      .get() as {
      total: number;
      ready: number;
      pending: number;
      unavailable: number;
      deferred: number;
      limited: number;
    };
    const reasons = this.db
      .prepare(
        `SELECT coalesce(json_extract(failure,'$.reason'),'UNKNOWN') reason,count(*) count
      FROM ${table} JOIN visible USING(id) WHERE state IN ('unavailable','deferred') GROUP BY reason`,
      )
      .all() as {
      reason: ImageInputReason;
      count: number;
    }[];
    return { ...counts, reasons };
  }
  private channels() {
    return { visual: this.channelCoverage('images'), ocr: this.channelCoverage('ocr') };
  }
  private affected(channel: 'visual' | 'ocr' | 'both') {
    const visual = "(i.state IN ('unavailable','deferred') OR (i.state='ready' AND i.limited=1))";
    const ocr = "(o.state IN ('unavailable','deferred') OR (o.state='ready' AND o.limited=1))";
    const condition = channel === 'both' ? `${visual} OR ${ocr}` : channel === 'visual' ? visual : ocr;
    return (
      this.db
        .prepare(
          `SELECT count(*) count FROM images i JOIN visible v ON v.id=i.id
      LEFT JOIN ocr o ON o.id=i.id AND o.hash=i.hash WHERE ${condition}`,
        )
        .get() as { count: number }
    ).count;
  }
  issues(channel: 'visual' | 'ocr', after: string) {
    const table = channel === 'visual' ? 'images' : 'ocr';
    return this.db
      .transaction(() => {
        const rows = this.db
          .prepare(
            `SELECT i.id,i.title,c.failure,c.limited FROM ${table} c
        JOIN visible v ON v.id=c.id JOIN images i ON i.id=c.id
        WHERE c.id>? AND (c.state IN ('unavailable','deferred') OR c.limited=1) ORDER BY c.id LIMIT 31`,
          )
          .all(after) as {
          id: string;
          title: string;
          failure: string | null;
          limited: number;
        }[];
        return {
          items: rows.slice(0, 30).map((row) => ({
            ...row,
            limited: Boolean(row.limited),
            failure: row.failure
              ? JSON.parse(row.failure)
              : row.limited
                ? null
                : { reason: 'UNKNOWN', stage: 'prepare' },
          })),
          next: rows.length > 30 ? rows[29].id : null,
          generation: this.generation,
        };
      })
      .deferred();
  }

  searchMetadata(query: string, offset: number, checkCancelled: () => void = () => {}, refresh = false) {
    const reset = refresh || this.keywordQuery !== query;
    const result = this.db
      .transaction(() => {
        if (reset) this.db.exec('DELETE FROM keyword_results');
        return this.scanMetadata(query, offset, checkCancelled);
      })
      .deferred();
    // Publish the session only after a successful transaction; cancellation keeps the old ranking intact.
    if (reset) {
      this.keywordQuery = query;
      this.keywordGeneration++;
    }
    return { ...result, generation: this.keywordGeneration };
  }

  private scanMetadata(query: string, offset: number, checkCancelled: () => void) {
    this.rankKeywords(query, checkCancelled);
    // Names are all available on the first lookup. Later OCR matches append without moving existing pages.
    this.db.exec(`INSERT INTO keyword_results (id,match,preview)
      SELECT l.id,l.match,l.preview FROM lexical l JOIN images i USING(id)
      WHERE NOT EXISTS (SELECT 1 FROM keyword_results k WHERE k.id=l.id)
      ORDER BY l.tier,json_extract(i.metadata,'$.createdAt') DESC,l.id`);
    const rows = this.db
      .prepare(
        `SELECT images.id,title,metadata,match,preview FROM keyword_results JOIN images USING(id)
      ORDER BY position LIMIT 31 OFFSET ?`,
      )
      .all(offset) as {
      id: string;
      title: string;
      metadata: string;
      match: 'EXACT' | 'TEXT' | 'OCR';
      preview: string;
    }[];
    const coverage = this.ocrCoverage();
    return {
      items: rows.map(({ metadata, preview, ...row }): ImageSearchItem => ({
        ...row,
        ...JSON.parse(metadata),
        score: null,
        ...(row.match === 'OCR' ? { preview } : {}),
      })),
      coverage,
      channels: this.channels(),
      affected: this.affected('ocr'),
      ...(process.platform !== 'win32'
        ? { warning: 'OCR_UNSUPPORTED' as const }
        : this.db
              .prepare(
                "SELECT 1 FROM ocr JOIN visible USING(id) WHERE json_extract(failure,'$.reason')='OCR_UNAVAILABLE' LIMIT 1",
              )
              .get()
          ? { warning: 'OCR_UNAVAILABLE' as const }
          : {}),
    };
  }

  private rankKeywords(query: string, checkCancelled: () => void) {
    const parsed = contentSearchQuery(query);
    this.db.exec('DELETE FROM lexical');
    if (!parsed.terms.length) return;
    // At most 32 × 250k text units per batch; cancellation never waits for a whole OCR corpus scan.
    const read = this.db.prepare(`SELECT i.id,i.aliases,coalesce(o.text,'') text FROM images i
      JOIN visible v ON v.id=i.id LEFT JOIN ocr o ON o.id=i.id AND o.hash=i.hash AND o.state='ready'
      WHERE i.id>? ORDER BY i.id LIMIT 32`);
    const insert = this.db.prepare(`INSERT INTO lexical SELECT json_extract(value,'$[0]'),
      json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') FROM json_each(?)`);
    let after = '';
    for (;;) {
      checkCancelled();
      const rows = read.all(after) as { id: string; aliases: string; text: string }[];
      if (!rows.length) break;
      const matches: [string, number, string, string][] = [];
      for (const row of rows) {
        const names = [row.id, ...(JSON.parse(row.aliases) as string[])].map(normalizeSearchText);
        const exact = names.includes(parsed.phrase);
        const metadata = parsed.terms.every((term) => names.some((name) => name.includes(term)));
        const text = normalizeSearchText(row.text);
        if (
          !exact &&
          !metadata &&
          !parsed.terms.every((term) => text.includes(term) || names.some((name) => name.includes(term)))
        )
          continue;
        matches.push([
          row.id,
          exact ? 0 : metadata ? 1 : 2,
          exact ? 'EXACT' : metadata ? 'TEXT' : 'OCR',
          exact || metadata ? '' : contentSearchSnippet(row.text, parsed.terms),
        ]);
      }
      if (matches.length) insert.run(JSON.stringify(matches));
      after = rows.at(-1)!.id;
    }
  }

  search(query: string, vector: Float32Array | null, offset: number, checkCancelled: () => void, hybrid = false) {
    // WAL lets the index writer commit while this reader sees a consistent snapshot.
    return this.db.transaction(() => this.scan(vector, offset, checkCancelled, hybrid, query)).deferred();
  }

  private scan(
    vector: Float32Array | null,
    offset: number,
    checkCancelled: () => void,
    hybrid: boolean,
    query: string,
  ) {
    this.db.exec('DELETE FROM scores');
    const read = this.db.prepare(
      `SELECT id,vector FROM images JOIN visible USING(id) WHERE id>? ORDER BY id LIMIT 128`,
    );
    const insert = this.db.prepare('INSERT INTO scores VALUES (?,?,?)');
    let after = '';
    for (;;) {
      checkCancelled();
      const rows = read.all(after) as CachedImage[];
      if (!rows.length) break;
      this.db.transaction(() => {
        for (const row of rows) {
          let score: number | null = null;
          if (vector && row.vector?.byteLength === 768 * 4) {
            score = 0;
            for (let index = 0; index < 768; index++) score += row.vector.readFloatLE(index * 4) * vector[index];
            if (!Number.isFinite(score)) throw new Error('INVALID_EMBEDDING');
            score = Math.max(-1, Math.min(1, score));
          }
          if (score !== null) insert.run(row.id, score, 0);
        }
      })();
      after = rows.at(-1)!.id;
    }
    if (hybrid) this.rankKeywords(query, checkCancelled);
    const rows = this.db
      .prepare(
        hybrid
          ? `WITH semantic AS (SELECT *,row_number() OVER (ORDER BY score DESC,id) rank FROM scores),
          words AS (SELECT *,row_number() OVER (ORDER BY tier,id) rank FROM lexical),
          candidates AS (SELECT id FROM scores UNION SELECT id FROM lexical)
          SELECT images.id,title,metadata,score,0 exact,l.match,l.preview FROM candidates k JOIN images ON images.id=k.id
          LEFT JOIN semantic s ON s.id=k.id LEFT JOIN words l ON l.id=k.id
          ORDER BY CASE WHEN l.tier=0 THEN 0 ELSE 1 END,
            coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+l.rank),0) DESC,k.id LIMIT 31 OFFSET ?`
          : `SELECT images.id,title,metadata,score,exact,NULL AS match,NULL preview FROM scores JOIN images USING(id)
      ORDER BY exact DESC,score DESC,images.id LIMIT 31 OFFSET ?`,
      )
      .all(offset) as {
      id: string;
      title: string;
      metadata: string;
      score: number | null;
      exact: number;
      match: ImageSearchItem['match'] | null;
      preview: string | null;
    }[];
    const items: ImageSearchItem[] = rows.map(({ exact, metadata, match, preview, ...row }) => ({
      ...row,
      ...JSON.parse(metadata),
      match: match ?? (exact ? 'EXACT' : 'SEMANTIC'),
      ...(preview && match === 'OCR' ? { preview } : {}),
      borderline: !match && !exact && isBorderline(row.score ?? -1, 'image'),
    }));
    const counts = this.db
      .prepare('SELECT state,count(*) AS count FROM images JOIN visible USING(id) GROUP BY state')
      .all() as { state: string; count: number }[];
    const coverage = { total: 0, ready: 0, pending: 0, unavailable: 0, limited: 0 };
    for (const { state, count } of counts) {
      coverage.total += count;
      if (state === 'ready' || state === 'pending' || state === 'unavailable') coverage[state] = count;
      if (state === 'deferred') coverage.limited += count;
    }
    coverage.limited += this.channelCoverage('images').limited;
    const ocr = this.ocrCoverage();
    const visualPending = coverage.pending;
    if (hybrid) {
      // Count each image once, even when both visual and OCR indexing are incomplete.
      const combined = this.db
        .prepare(
          `SELECT count(*) total,
        coalesce(sum(i.state='ready' AND o.state='ready'),0) ready,
        coalesce(sum(i.state='pending' OR o.state='pending'),0) pending,
        coalesce(sum(i.state!='pending' AND coalesce(o.state,'unavailable')!='pending'
          AND (i.state='unavailable' OR coalesce(o.state,'unavailable')='unavailable')),0) unavailable,
        coalesce(sum(i.state NOT IN ('pending','unavailable') AND coalesce(o.state,'unavailable') NOT IN ('pending','unavailable')
          AND (i.state='deferred' OR o.state='deferred' OR i.limited=1 OR o.limited=1)),0) limited
        FROM images i JOIN visible v ON v.id=i.id LEFT JOIN ocr o ON o.id=i.id`,
        )
        .get() as typeof coverage;
      Object.assign(coverage, combined);
    }
    return {
      items,
      coverage,
      channels: this.channels(),
      affected: this.affected(hybrid ? 'both' : 'visual'),
      visualPending,
      generation: this.generation,
      ...(hybrid && process.platform !== 'win32'
        ? { warning: 'OCR_UNSUPPORTED' as const }
        : hybrid &&
            ocr.unavailable &&
            this.db
              .prepare(
                "SELECT 1 FROM ocr JOIN visible USING(id) WHERE json_extract(failure,'$.reason')='OCR_UNAVAILABLE' LIMIT 1",
              )
              .get()
          ? { warning: 'OCR_UNAVAILABLE' as const }
          : {}),
    };
  }
}
