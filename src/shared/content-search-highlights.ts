import { contentSearchQuery, normalizeSearchText } from '@/shared/content-search-query';

type Match = { start: number; end: number };

export function contentSearchTerms(query: string): readonly string[] {
  try {
    return contentSearchQuery(query).terms;
  } catch {
    return [];
  }
}

function appendMatch(matches: Match[], match: Match) {
  const previous = matches.at(-1);
  if (previous && match.start < previous.end) previous.end = Math.max(previous.end, match.end);
  else matches.push(match);
}

/** Literal matches mapped back to stored spelling, including NFKC expansions and grapheme clusters. */
export function contentSearchHighlights(text: string, terms: readonly string[]) {
  if (!terms.length || !text) return [];
  const normalized = normalizeSearchText(text);
  const matches: Match[] = [];
  const positions = terms.map((term) => (term ? normalized.indexOf(term) : -1));
  // Merge overlaps as they are found instead of allocating every overlapping term occurrence.
  while (true) {
    let next = -1;
    for (let index = 0; index < positions.length; index++) {
      if (positions[index]! >= 0 && (next < 0 || positions[index]! < positions[next]!)) next = index;
    }
    if (next < 0) break;
    const start = positions[next]!;
    appendMatch(matches, { start, end: start + terms[next]!.length });
    positions[next] = normalized.indexOf(terms[next]!, start + 1);
  }
  if (!matches.length || !/[^\x00-\x7f]/u.test(text)) return matches;
  const starts = new Uint32Array(normalized.length);
  const ends = new Uint32Array(normalized.length);
  let offset = 0;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const end = offset + normalizeSearchText(part.segment).length;
    starts.fill(part.index, offset, end);
    ends.fill(part.index + part.segment.length, offset, end);
    offset = end;
  }
  const original: Match[] = [];
  for (const match of matches) appendMatch(original, { start: starts[match.start]!, end: ends[match.end - 1]! });
  return original;
}
