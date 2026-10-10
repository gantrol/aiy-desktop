import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { SemanticContentSource } from '@/main/image-search/content-protocol';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import type { ImageSearchEncoder } from '@/main/image-search/encoder';
import { contentSearchQuery, normalizeSearchText } from '@/shared/content-search-query';
import { hasSearchContent, isBorderline, rankDocumentSimilarity } from '@/main/image-search/relevance';

/** Rebuildable document/chunk cache. All filesystem, SQL and vector work stays in a Worker. */
export class ContentVectorCache {
  private db: Database.Database;
  private background: Float32Array | undefined;
  generation = 0;

  constructor(filePath: string, fingerprint: string) {
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY,stamp TEXT,kind TEXT,state TEXT,metadata TEXT);
      CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY,document TEXT,position INTEGER,text TEXT,state TEXT,vector BLOB);
      CREATE INDEX IF NOT EXISTS chunk_document ON chunks(document);
      CREATE TEMP TABLE visible (key TEXT PRIMARY KEY);
      CREATE TEMP TABLE scores (key TEXT PRIMARY KEY,chunk INTEGER,score REAL,ranking REAL,background REAL);`);
    this.db.exec('CREATE TEMP TABLE lexical (key TEXT PRIMARY KEY,chunk INTEGER,tier INTEGER,match TEXT,mask INTEGER)');
    this.db.function('search_fold', normalizeSearchText);
    const model = `${fingerprint}:text-chunks-v1`;
    if (this.db.prepare("SELECT value FROM meta WHERE key='model'").pluck().get() !== model) {
      this.db.transaction(() => {
        this.db.exec('DELETE FROM documents; DELETE FROM chunks;');
        this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('model',?)").run(model);
      })();
    }
    // Purge only empty cached passages; preserve vectors for meaningful saved content.
    this.db.function('search_has_content', (value: string) => Number(hasSearchContent(value)));
    this.db.exec(`DELETE FROM chunks WHERE NOT search_has_content(text) AND document IN
      (SELECT key FROM documents WHERE NOT search_has_content(json_extract(metadata,'$.title')))`);
  }

  startSync() {
    this.db.exec('DELETE FROM visible');
  }
  finishSync() {
    this.db.exec(`DELETE FROM chunks WHERE document NOT IN (SELECT key FROM visible);
      DELETE FROM documents WHERE key NOT IN (SELECT key FROM visible);`);
    this.generation++;
  }
  close() {
    this.db.close();
  }

  synchronize(items: SemanticContentSource[], checkCancelled: () => void) {
    this.db.transaction(() => {
      for (const item of items) {
        checkCancelled();
        this.db.prepare('INSERT OR IGNORE INTO visible VALUES (?)').run(item.key);
        const stamp = createHash('sha256')
          .update(JSON.stringify([item.stamp, item.state, item.title, item.body]))
          .digest('hex');
        const previous = this.db.prepare('SELECT stamp,metadata FROM documents WHERE key=?').get(item.key) as
          { stamp: string; metadata: string } | undefined;
        if (previous?.stamp === stamp) continue;
        // A reopened text index starts as pending. Keep vectors for the same authoritative revision.
        if (previous && (item.state === 'pending' || item.state === 'limited')) {
          const cached = JSON.parse(previous.metadata) as SemanticContentSource;
          if (cached.stamp === item.stamp && cached.state === 'ready') continue;
        }
        this.db.prepare('DELETE FROM chunks WHERE document=?').run(item.key);
        const { body, ...metadata } = item;
        this.db
          .prepare('INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?)')
          .run(item.key, stamp, item.source.kind, item.state, JSON.stringify(metadata));
        if (item.state !== 'ready' && item.state !== 'limited') continue;
        if (!hasSearchContent(item.title) && !hasSearchContent(body)) continue;
        const points = Array.from(body);
        const insert = this.db.prepare("INSERT INTO chunks(document,position,text,state) VALUES (?,?,?,'pending')");
        // Bounded overlapping passages retain Unicode characters and the actual evidence text.
        for (let start = 0; start < Math.max(1, points.length); start += 1_000) {
          const passage = points.slice(start, start + 1_200).join('');
          if (hasSearchContent(passage) || (start === 0 && hasSearchContent(item.title)))
            insert.run(item.key, start, passage);
          if (start + 1_200 >= points.length) break;
        }
      }
    })();
  }

  async advance(encoder: ImageSearchEncoder, type: string, retry: boolean, checkCancelled: () => void) {
    if (retry) this.db.prepare("UPDATE chunks SET state='pending' WHERE state='unavailable'").run();
    const row = this.db
      .prepare(
        `SELECT c.id,c.text,d.metadata FROM chunks c
      JOIN documents d ON d.key=c.document JOIN visible v ON v.key=d.key
      WHERE c.state='pending' AND (?='ALL' OR d.kind=?) ORDER BY c.position,c.id LIMIT 1`,
      )
      .get(type, type) as { id: number; text: string; metadata: string } | undefined;
    if (!row) return;
    checkCancelled();
    const metadata = JSON.parse(row.metadata) as SemanticContentSource;
    const vector = await encoder.document(metadata.title, row.text);
    // Completed work is reusable even if its consumer was cancelled during inference.
    this.db
      .prepare("UPDATE chunks SET state='ready',vector=? WHERE id=?")
      .run(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), row.id);
    this.generation++;
    checkCancelled();
  }

  async search(
    query: string,
    type: string,
    offset: number,
    encoder: ImageSearchEncoder,
    checkCancelled: () => void,
    hybrid = false,
  ) {
    const coverage = this.db
      .prepare(
        `SELECT count(*) total,
      coalesce(sum(d.state='ready' AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document=d.key AND c.state!='ready')),0) ready,
      coalesce(sum(d.state='pending' OR EXISTS (SELECT 1 FROM chunks c WHERE c.document=d.key AND c.state='pending')),0) pending,
      coalesce(sum(d.state='unavailable'),0) unavailable,coalesce(sum(d.state='limited'),0) limited
      FROM documents d JOIN visible USING(key) WHERE ?='ALL' OR d.kind=?`,
      )
      .get(type, type) as ContentLookupResult['coverage'];
    this.db.exec('DELETE FROM scores');
    const read = this.db.prepare(`SELECT c.id,c.document,c.vector FROM chunks c JOIN documents d ON d.key=c.document
      JOIN visible v ON v.key=d.key WHERE c.state='ready' AND c.id>? AND (?='ALL' OR d.kind=?) ORDER BY c.id LIMIT 128`);
    const save = this.db.prepare(`INSERT INTO scores VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
      chunk=excluded.chunk,score=excluded.score,ranking=excluded.ranking,background=excluded.background
      WHERE excluded.ranking>scores.ranking`);
    let after = 0;
    let vector: Float32Array | undefined;
    for (;;) {
      checkCancelled();
      const rows = read.all(after, type, type) as { id: number; document: string; vector: Buffer }[];
      if (!rows.length) break;
      vector ??= await encoder.query(query);
      checkCancelled();
      // One model-specific baseline per worker; no library centroid or user-query history is needed.
      const background = (this.background ??= await encoder.query(''));
      checkCancelled();
      this.db.transaction(() => {
        for (const row of rows) {
          if (row.vector.byteLength !== 768 * 4) throw new Error('UNAVAILABLE');
          let score = 0;
          let baseline = 0;
          for (let index = 0; index < 768; index++) {
            const value = row.vector.readFloatLE(index * 4);
            score += value * vector![index];
            baseline += value * background[index];
          }
          if (!Number.isFinite(score) || !Number.isFinite(baseline)) throw new Error('UNAVAILABLE');
          score = Math.max(-1, Math.min(1, score));
          baseline = Math.max(-1, Math.min(1, baseline));
          save.run(row.document, row.id, score, rankDocumentSimilarity(score, baseline), baseline);
        }
      })();
      after = rows.at(-1)!.id;
    }
    this.db.exec('DELETE FROM lexical');
    if (hybrid) this.rankKeywords(query, type, checkCancelled);
    const rows = this.db
      .prepare(
        hybrid
          ? `WITH semantic AS (
          SELECT *,row_number() OVER (ORDER BY ranking DESC,key) rank FROM scores
        ), words AS (
          SELECT *,row_number() OVER (ORDER BY tier,key) rank FROM lexical
        ), candidates AS (SELECT key FROM scores UNION SELECT key FROM lexical)
        SELECT d.metadata,coalesce(c.text,'') text,s.score,s.background,l.match FROM candidates k
        JOIN documents d ON d.key=k.key LEFT JOIN semantic s ON s.key=k.key LEFT JOIN words l ON l.key=k.key
        LEFT JOIN chunks c ON c.id=coalesce(l.chunk,s.chunk)
        ORDER BY CASE WHEN l.tier=0 THEN 0 ELSE 1 END,
          coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+l.rank),0) DESC,k.key LIMIT 31 OFFSET ?`
          : `SELECT d.metadata,c.text,s.score,s.background,'SEMANTIC' AS match FROM scores s
      JOIN documents d USING(key) JOIN chunks c ON c.id=s.chunk ORDER BY s.ranking DESC,s.key LIMIT 31 OFFSET ?`,
      )
      .all(offset) as {
      metadata: string;
      text: string;
      score: number | null;
      background: number | null;
      match: 'ID' | 'TITLE' | 'BODY' | 'SEMANTIC' | null;
    }[];
    return {
      generation: this.generation,
      coverage,
      items: rows.map(({ metadata, text, score, background, match }): ContentLookupResult['items'][number] => {
        const item = JSON.parse(metadata) as SemanticContentSource;
        return {
          source: item.source,
          title: item.title,
          preview: text,
          bodyIndexed: item.state === 'ready',
          updatedAt: item.updatedAt,
          branchRole: item.branchRole,
          match: match ?? 'SEMANTIC',
          ...(score !== null ? { score } : {}),
          // A complete document may carry all its content in the title; only missing coverage is insufficient.
          borderline:
            !match || match === 'SEMANTIC'
              ? item.state !== 'ready' || isBorderline(score ?? -1, 'document') || (score ?? -1) <= (background ?? -1)
              : false,
        };
      }),
    };
  }

  private rankKeywords(query: string, type: string, checkCancelled: () => void) {
    const parsed = contentSearchQuery(query);
    if (!parsed.terms.length) return;
    const allTerms = (1 << parsed.terms.length) - 1;
    const termMask = (text: string) =>
      parsed.terms.reduce((mask, term, index) => (text.includes(term) ? mask | (1 << index) : mask), 0);
    // Explicit identity lookup remains possible for a document excluded from semantic indexing.
    this.db
      .prepare(
        `INSERT INTO lexical SELECT key,NULL,0,'ID',? FROM documents JOIN visible USING(key)
      WHERE search_fold(json_extract(metadata,'$.source.id'))=? AND (?='ALL' OR kind=?)`,
      )
      .run(allTerms, parsed.phrase, type, type);
    const read = this.db.prepare(`SELECT d.key,d.metadata,c.id,c.text FROM documents d
      JOIN visible v ON v.key=d.key JOIN chunks c ON c.document=d.key
      WHERE c.id>? AND (?='ALL' OR d.kind=?) ORDER BY c.id LIMIT 128`);
    const save = this.db.prepare(`INSERT INTO lexical VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
      chunk=CASE WHEN excluded.tier<lexical.tier THEN excluded.chunk ELSE lexical.chunk END,
      match=CASE WHEN excluded.tier<lexical.tier THEN excluded.match ELSE lexical.match END,
      tier=min(lexical.tier,excluded.tier),mask=lexical.mask|excluded.mask`);
    let after = 0;
    for (;;) {
      checkCancelled();
      const rows = read.all(after, type, type) as { key: string; metadata: string; id: number; text: string }[];
      if (!rows.length) break;
      this.db.transaction(() => {
        for (const row of rows) {
          const item = JSON.parse(row.metadata) as SemanticContentSource;
          const title = normalizeSearchText(item.title);
          const body = normalizeSearchText(row.text);
          const exact = normalizeSearchText(item.source.id) === parsed.phrase;
          const titleMask = termMask(title);
          const mask = exact ? allTerms : titleMask | termMask(body);
          if (!mask) continue;
          const tier = exact ? 0 : title === parsed.phrase ? 1 : titleMask === allTerms ? 2 : 3;
          save.run(row.key, row.id, tier, exact ? 'ID' : tier < 3 ? 'TITLE' : 'BODY', mask);
        }
      })();
      after = rows.at(-1)!.id;
    }
    this.db.prepare('DELETE FROM lexical WHERE mask!=?').run(allTerms);
  }
}
