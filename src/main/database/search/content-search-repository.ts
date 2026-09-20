import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { ContentDocument } from '@/shared/contracts/content-library';
import type { ContentSource } from '@/shared/contracts/content-source';
import type { ContentLookupInput, ContentLookupResult } from '@/shared/contracts/content-search';
import { contentSearchQuery, contentSearchSnippet } from '@/shared/content-search-query';
import { ContentSearchIndex } from '@/main/database/search/content-search-index';

const PAGE_SIZE = 30;
type SearchRow = {
  source: string;
  title: string;
  body: string;
  state: string;
  id: string;
  updated_at: string;
  branch_role: string | null;
  tier: number;
};

export class ContentSearchRepository {
  private readonly index: ContentSearchIndex;
  constructor(
    private readonly db: Database.Database,
    read: (source: ContentSource) => ContentDocument,
  ) {
    this.index = new ContentSearchIndex(db, read);
  }

  lookup(input: ContentLookupInput): ContentLookupResult {
    const query = contentSearchQuery(input.query);
    this.index.initialize();
    return this.db.transaction((): ContentLookupResult => {
      this.index.refreshSources();
      this.index.prepare(input.retryUnavailable, input.type, input.advanceIndex !== false);
      const revision = this.db.prepare('SELECT coalesce(max(rowid),0) FROM main.change_events').pluck().get();
      const dataVersion = this.db.pragma('data_version', { simple: true });
      const queryId = createHash('sha256')
        .update(JSON.stringify([input.type, query.terms]))
        .digest('hex');
      const snapshot = `${revision}:${dataVersion}:${this.index.generation}:${queryId}`;
      const reset = Boolean(input.offset && input.snapshot !== snapshot);
      const offset = reset ? 0 : input.offset;
      const coverage = this.coverage(input.type);
      const values: unknown[] = [];
      const conditions = ["e.state IN ('ready','limited')"];
      if (input.type !== 'ALL') {
        conditions.push('c.kind=?');
        values.push(input.type);
      }
      if (query.match) {
        conditions.push('e.rowid IN (SELECT rowid FROM temp.aiy_search_fts WHERE aiy_search_fts MATCH ?)');
        values.push(query.match);
      }
      for (const term of query.terms) {
        conditions.push('(instr(f.title,?)>0 OR instr(f.body,?)>0 OR f.identity=?)');
        values.push(term, term, term);
      }
      const ranked = query.terms.length
        ? `CASE WHEN f.identity=? THEN 0 WHEN f.title=? THEN 1
        WHEN ${query.terms.map(() => 'instr(f.title,?)>0').join(' AND ')} THEN 2 ELSE 3 END`
        : '4';
      const rankValues = query.terms.length ? [query.phrase, query.phrase, ...query.terms] : [];
      const rows = this.db
        .prepare(
          `SELECT e.source,e.title,e.body,e.state,c.id,c.updated_at,c.branch_role,${ranked} tier
        FROM temp.aiy_search_entries e JOIN temp.aiy_search_sources c ON c.key=e.key AND c.stamp=e.stamp
        JOIN temp.aiy_search_fts f ON f.rowid=e.rowid WHERE ${conditions.join(' AND ')}
        ORDER BY tier,c.updated_at DESC,c.key LIMIT ? OFFSET ?`,
        )
        .all(...rankValues, ...values, PAGE_SIZE + 1, offset) as SearchRow[];
      return {
        scope: 'CURRENT_SAVED_DOCUMENTS',
        snapshot,
        reset,
        coverage,
        items: rows.slice(0, PAGE_SIZE).map((row) => ({
          source: JSON.parse(row.source) as ContentSource,
          title: row.title || contentSearchSnippet(row.body, [], 24),
          preview: contentSearchSnippet(row.body, query.terms),
          bodyIndexed: row.state === 'ready',
          updatedAt: row.updated_at,
          branchRole: row.branch_role,
          match: row.tier === 0 ? 'ID' : row.tier < 3 ? 'TITLE' : row.tier === 3 ? 'BODY' : 'RECENT',
        })),
        // Do not paginate a ranking that is still growing underneath the caller.
        nextOffset: !coverage.pending && rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
      };
    })();
  }

  private coverage(type: ContentLookupInput['type']): ContentLookupResult['coverage'] {
    const row = this.db
      .prepare(
        `SELECT count(*) total,
      coalesce(sum(e.state='ready'),0) ready, coalesce(sum(e.rowid IS NULL OR e.state='pending'),0) pending,
      coalesce(sum(e.state='unavailable'),0) unavailable, coalesce(sum(e.state='limited'),0) limited
      FROM temp.aiy_search_sources c LEFT JOIN temp.aiy_search_entries e ON c.key=e.key AND c.stamp=e.stamp
      ${type === 'ALL' ? '' : 'WHERE c.kind=?'}`,
      )
      .get(...(type === 'ALL' ? [] : [type]));
    return row as ContentLookupResult['coverage'];
  }
}
