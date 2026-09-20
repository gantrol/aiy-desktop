/** History search is a literal phrase, with case, width and whitespace normalized. */
export function normalizeCodexHistoryQuery(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Map every occurrence back to the original spelling; never insert query text as HTML. */
export function codexHistoryHighlights(text: string, query: string, limit = Number.POSITIVE_INFINITY) {
  const needle = normalizeCodexHistoryQuery(query);
  if (!needle) return [];
  const normalized = normalizeCodexHistoryQuery(text);
  const matches: Array<{ start: number; end: number }> = [];
  for (let start = normalized.indexOf(needle); start >= 0; start = normalized.indexOf(needle, start + 1)) {
    const end = start + needle.length;
    const previous = matches.at(-1);
    if (previous && start <= previous.end) previous.end = end;
    else matches.push({ start, end });
    if (matches.length >= limit) break;
  }
  if (!matches.length || normalized === text) return matches;
  const neededLength = matches.at(-1)!.end;
  const starts = new Uint32Array(neededLength);
  const ends = new Uint32Array(neededLength);
  let offset = 0;
  let lastWasSpace = true;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    for (const character of part.segment.normalize('NFKC').toLowerCase()) {
      const space = /\s/u.test(character);
      if (space && lastWasSpace) {
        if (offset) ends[offset - 1] = part.index + part.segment.length;
        continue;
      }
      const value = space ? ' ' : character;
      for (let unit = 0; unit < value.length; unit++) {
        starts[offset] = part.index;
        ends[offset++] = part.index + part.segment.length;
      }
      lastWasSpace = space;
    }
    if (offset >= neededLength) break;
  }
  // Full-string case conversion preserves context-dependent casing (for example Greek sigma).
  const original: Array<{ start: number; end: number }> = [];
  for (const match of matches) {
    const start = starts[match.start]!;
    const end = ends[match.end - 1]!;
    const previous = original.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else original.push({ start, end });
  }
  return original;
}

export function codexHistorySnippet(text: string, query: string, radius = 120) {
  const compact = text.replace(/\s+/gu, ' ').trim();
  const match = codexHistoryHighlights(compact, query, 1)[0];
  const start = Math.max(0, (match?.start ?? 0) - radius);
  const end = Math.min(compact.length, match ? match.end + radius : radius * 2);
  return `${start ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}
