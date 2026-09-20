import type Database from 'better-sqlite3';
import type { ContentDocument } from '@/shared/contracts/content-library';
import type { ContentSource } from '@/shared/contracts/content-source';
import { normalizeSearchText } from '@/shared/content-search-query';
import { contentSearchBody } from '@/shared/content-search-body';
import {
  candidateSource,
  installContentSearchView,
  type ContentSearchCandidate,
} from '@/main/database/search/content-search-candidates';

const MAX_BODY_UNITS = 8 * 1024 * 1024;
const MAX_DOCUMENT_UNITS = 250_000;
const BATCH_SIZE = 16;
const BATCH_BUDGET_MS = 30;

/** Per-open-library cache: no persistent schema migration and no network or file discovery. */
export class ContentSearchIndex {
  private installed = false;
  generation = 0;
  constructor(
    readonly db: Database.Database,
    private readonly read: (source: ContentSource) => ContentDocument,
  ) {}

  initialize() {
    if (!this.installed) {
      installContentSearchView(this.db);
      this.db.exec(`CREATE TEMP TABLE IF NOT EXISTS aiy_search_sources (
        key TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL, branch_id TEXT,
        branch_role TEXT, revision_id TEXT, updated_at TEXT NOT NULL, stamp TEXT NOT NULL);
        CREATE TEMP TABLE IF NOT EXISTS aiy_search_entries (
        rowid INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, stamp TEXT NOT NULL,
        source TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
        state TEXT NOT NULL, units INTEGER NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS temp.aiy_search_fts USING fts5(
          title, body, identity, tokenize='trigram case_sensitive 1');`);
      this.installed = true;
    }
  }

  refreshSources() {
    // Materialize once inside the lookup transaction. Repeated joins against an
    // unindexed UNION view otherwise become quadratic even in a modest library.
    this.db.exec(`DELETE FROM temp.aiy_search_sources;
      INSERT INTO temp.aiy_search_sources SELECT * FROM temp.aiy_search_current;`);
  }

  prepare(retry: boolean, kind: string, advance: boolean) {
    const removed = this.db
      .prepare(
        `SELECT e.rowid FROM temp.aiy_search_entries e
      LEFT JOIN temp.aiy_search_sources c ON c.key=e.key AND c.stamp=e.stamp
      WHERE c.key IS NULL LIMIT 256`,
      )
      .all() as { rowid: number }[];
    const remove = this.db.prepare('DELETE FROM temp.aiy_search_entries WHERE rowid=?');
    const removeFts = this.db.prepare('DELETE FROM temp.aiy_search_fts WHERE rowid=?');
    for (const { rowid } of removed) {
      removeFts.run(rowid);
      remove.run(rowid);
    }
    if (removed.length) this.generation++;
    if (retry) {
      const changed = this.db
        .prepare(
          `UPDATE temp.aiy_search_entries SET state='pending'
        WHERE state IN ('unavailable','limited') AND key IN (
          SELECT key FROM temp.aiy_search_sources WHERE ?='ALL' OR kind=?)`,
        )
        .run(kind, kind);
      if (changed.changes) this.generation++;
    }
    if (!advance) return;
    const candidates = this.db
      .prepare(
        `SELECT c.* FROM temp.aiy_search_sources c
      LEFT JOIN temp.aiy_search_entries e ON e.key=c.key AND e.stamp=c.stamp
      WHERE (e.rowid IS NULL OR e.state='pending') AND (?='ALL' OR c.kind=?)
      ORDER BY c.updated_at DESC, c.key LIMIT ?`,
      )
      .all(kind, kind, BATCH_SIZE) as ContentSearchCandidate[];
    let units = Number(this.db.prepare('SELECT coalesce(sum(units),0) FROM temp.aiy_search_entries').pluck().get());
    const deadline = performance.now() + BATCH_BUDGET_MS;
    for (const candidate of candidates) {
      units += this.index(candidate, units);
      if (performance.now() >= deadline) break;
    }
  }

  private index(candidate: ContentSearchCandidate, units: number): number {
    // A large stale cache is pruned in batches. Replace this candidate even if
    // its old row was beyond that batch, without violating its unique identity.
    const previous = this.db
      .prepare('SELECT rowid,units FROM temp.aiy_search_entries WHERE key=?')
      .get(candidate.key) as { rowid: number; units: number } | undefined;
    if (previous) {
      this.db.prepare('DELETE FROM temp.aiy_search_fts WHERE rowid=?').run(previous.rowid);
      this.db.prepare('DELETE FROM temp.aiy_search_entries WHERE rowid=?').run(previous.rowid);
      units -= previous.units;
    }
    const source = candidateSource(candidate);
    let title = '';
    let body = '';
    let state = 'ready';
    try {
      // A broken current pointer is missing coverage, not permission to fall back to another revision.
      if (!candidate.revision_id) throw new Error('SEARCH_REVISION_UNAVAILABLE');
      const document = this.read(source);
      if (document.revisionId !== candidate.revision_id) throw new Error('SEARCH_REVISION_CHANGED');
      title = document.title;
      body = document.markdown;
      if (body.length > MAX_DOCUMENT_UNITS || units + body.length > MAX_BODY_UNITS) state = 'limited';
      else {
        body = contentSearchBody(body);
        if (body.length > MAX_DOCUMENT_UNITS || units + body.length > MAX_BODY_UNITS) state = 'limited';
      }
    } catch {
      state = 'unavailable';
    }
    if (state === 'unavailable') title = '';
    if (state !== 'ready') body = '';
    const size = body.length;
    const row = this.db
      .prepare(
        `INSERT INTO temp.aiy_search_entries
      (key,stamp,source,title,body,state,units) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(candidate.key, candidate.stamp, JSON.stringify(source), title, body, state, size);
    if (state !== 'unavailable')
      this.db
        .prepare(
          `INSERT INTO temp.aiy_search_fts
      (rowid,title,body,identity) VALUES (?,?,?,?)`,
        )
        .run(
          row.lastInsertRowid,
          normalizeSearchText(title),
          normalizeSearchText(body),
          normalizeSearchText(candidate.id),
        );
    this.generation++;
    return size - (previous?.units ?? 0);
  }
}
