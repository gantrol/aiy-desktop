import type Database from 'better-sqlite3';
import type { ContentDocument } from '@/shared/contracts/content-library';
import type { ContentSource } from '@/shared/contracts/content-source';
import type { KeywordResult, MeCommand } from '@/shared/contracts/me';
import { contentSearchSnippet } from '@/shared/content-search-query';
import {
  candidateSource,
  installContentSearchView,
  type ContentSearchCandidate,
} from '@/main/database/search/content-search-candidates';
import { keywordTerms, keywordText } from '@/main/database/me/keyword-terms';

type Entry = {
  stamp: string;
  state: 'ready' | 'limited' | 'unavailable';
  title: string;
  text: string;
  terms: Map<string, number>;
};
const MAX_SOURCES = 2_000;
const MAX_UNITS = 2_000_000;
const MAX_TERMS = 80_000;
const MAX_DOCUMENT_UNITS = 40_000;
const PAGE_SIZE = 20;

/** Per-open-space derived cache. Only visible consumers advance bounded batches. */
export class KeywordIndex {
  private readonly entries = new Map<string, Entry>();
  private installed = false;
  constructor(
    private readonly db: Database.Database,
    private readonly read: (source: ContentSource) => ContentDocument,
  ) {}

  query(input: Extract<MeCommand, { kind: 'keywords' }>): KeywordResult {
    if (!this.installed) {
      installContentSearchView(this.db);
      this.installed = true;
    }
    return this.db.transaction(() => this.snapshot(input))();
  }

  private snapshot(input: Extract<MeCommand, { kind: 'keywords' }>): KeywordResult {
    const total = Number(this.db.prepare('SELECT count(*) FROM temp.aiy_search_current').pluck().get());
    const sources = this.db
      .prepare('SELECT * FROM temp.aiy_search_current ORDER BY updated_at DESC,key LIMIT ?')
      .all(MAX_SOURCES) as ContentSearchCandidate[];
    const current = new Map(sources.map((source) => [source.key, source.stamp]));
    for (const [key, entry] of this.entries) {
      if (current.get(key) !== entry.stamp || (input.retry && entry.state !== 'ready')) this.entries.delete(key);
    }
    let units = 0,
      terms = 0;
    for (const entry of this.entries.values()) {
      units += entry.text.length;
      terms += entry.terms.size;
    }
    const deadline = performance.now() + 24;
    let processed = 0;
    for (const source of sources) {
      if (this.entries.has(source.key)) continue;
      const entry = this.index(source, units, terms);
      this.entries.set(source.key, entry);
      units += entry.text.length;
      terms += entry.terms.size;
      if (++processed >= 4 || performance.now() >= deadline) break;
    }
    const coverage = { total, ready: 0, pending: 0, limited: total - sources.length, unavailable: 0 };
    const words = new Map<string, { term: string; count: number; documents: number }>();
    const matching: { source: ContentSearchCandidate; entry: Entry }[] = [];
    for (const source of sources) {
      const entry = this.entries.get(source.key);
      if (!entry) {
        coverage.pending++;
        continue;
      }
      coverage[entry.state]++;
      for (const [term, count] of entry.terms) {
        const word = words.get(term) ?? { term, count: 0, documents: 0 };
        word.count += count;
        word.documents++;
        words.set(term, word);
      }
      if (input.term && entry.terms.has(input.term)) matching.push({ source, entry });
    }
    // Paging is stable only once this snapshot's bounded indexing is complete.
    const offset = coverage.pending ? 0 : input.offset;
    return {
      spaceId: input.spaceId,
      coverage,
      words: [...words.values()]
        .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
        .slice(0, 24),
      matches: matching.slice(offset, offset + PAGE_SIZE).map(({ source, entry }) => ({
        source: candidateSource(source),
        title: entry.title,
        preview: contentSearchSnippet(entry.text, [input.term]),
        bodyIndexed: true,
        updatedAt: source.updated_at,
        branchRole: source.branch_role,
        match: 'BODY',
      })),
      nextOffset: !coverage.pending && matching.length > offset + PAGE_SIZE ? offset + PAGE_SIZE : null,
    };
  }

  private index(source: ContentSearchCandidate, units: number, termCount: number): Entry {
    const empty = { stamp: source.stamp, title: '', text: '', terms: new Map<string, number>() };
    try {
      if (!source.revision_id) return { ...empty, state: 'unavailable' };
      if (units >= MAX_UNITS || termCount >= MAX_TERMS) return { ...empty, state: 'limited' };
      const document = this.read(candidateSource(source));
      if (document.revisionId !== source.revision_id) return { ...empty, state: 'unavailable' };
      if (document.markdown.length > MAX_DOCUMENT_UNITS) return { ...empty, state: 'limited' };
      const body = keywordText(document.markdown);
      if (units + body.length > MAX_UNITS) return { ...empty, state: 'limited' };
      const counts = keywordTerms(body);
      if (!counts || termCount + counts.size > MAX_TERMS) return { ...empty, state: 'limited' };
      return { stamp: source.stamp, state: 'ready', title: document.title, text: body, terms: counts };
    } catch {
      return { ...empty, state: 'unavailable' };
    }
  }
}
