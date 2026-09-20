/** Literal, locale-independent matching. Search normalization never rewrites content. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

export interface ContentSearchQuery {
  terms: string[];
  phrase: string;
  match: string | null;
}

/** Spaces mean AND; double quotes keep a phrase. No SQL, FTS, regex or agent commands. */
export function contentSearchQuery(input: string): ContentSearchQuery {
  if (input.length > 200 || input.includes('\0')) throw new Error('SEARCH_QUERY_INVALID');
  const value = normalizeSearchText(input).trim();
  const terms: string[] = [];
  let buffer = '';
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && (value[index + 1] === '"' || (quoted && value[index + 1] === '\\'))) buffer += value[++index];
    else if (char === '"') quoted = !quoted;
    else if (/\s/u.test(char) && !quoted) {
      if (buffer) terms.push(buffer);
      buffer = '';
    } else buffer += char;
  }
  // An unfinished phrase is useful while typing, and remains literal.
  if (buffer) terms.push(buffer);
  const unique = [...new Set(terms)];
  if (unique.length > 12) throw new Error('SEARCH_QUERY_INVALID');
  const indexed = unique.filter((term) => [...term].length >= 3);
  return {
    terms: unique,
    phrase: unique.join(' '),
    match: indexed.length ? indexed.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ') : null,
  };
}

/** A snippet is evidence text, not HTML. Keep the stored spelling and Unicode clusters. */
export function contentSearchSnippet(text: string, terms: readonly string[], radius = 80): string {
  if (!text) return '';
  const normalized = normalizeSearchText(text);
  const starts = terms.map((term) => normalized.indexOf(term)).filter((position) => position >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  // Normalization may change length (full-width, ligatures, combining characters).
  // Map the selected normalized position back to the original by grapheme.
  let normalizedOffset = 0;
  let originalOffset = 0;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (normalizedOffset + normalizeSearchText(part.segment).length > start) {
      originalOffset = part.index;
      break;
    }
    normalizedOffset += normalizeSearchText(part.segment).length;
  }
  const wantedLeft = Math.max(0, originalOffset - radius);
  const wantedRight = Math.min(text.length, originalOffset + radius * 2);
  let left = 0;
  let right = text.length;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (part.index <= wantedLeft) left = part.index;
    if (part.index >= wantedRight) {
      right = part.index;
      break;
    }
  }
  return `${left ? '…' : ''}${text.slice(left, right).replace(/\s+/gu, ' ')}${right < text.length ? '…' : ''}`;
}
