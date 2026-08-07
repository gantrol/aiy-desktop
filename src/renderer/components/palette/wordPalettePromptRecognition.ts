import type { TermListItem } from '@/shared/contracts';

export interface PalettePromptMatch {
  start: number;
  end: number;
  kind: 'EXACT' | 'SUGGESTION';
  term: TermListItem;
}

export interface PalettePromptAnalysis {
  matches: PalettePromptMatch[];
  linkedTermIds: string[];
  suggestionTermIds: string[];
}

function normalized(value: string) {
  return value.toLocaleLowerCase();
}

function validBoundary(source: string, start: number, length: number, phrase: string) {
  if (!/^[a-z0-9][a-z0-9 _-]*$/i.test(phrase)) return true;
  const previous = source[start - 1] ?? '';
  const next = source[start + length] ?? '';
  return !/[a-z0-9]/i.test(previous) && !/[a-z0-9]/i.test(next);
}

function phraseMatches(source: string, phrase: string) {
  const normalizedSource = normalized(source);
  const normalizedPhrase = normalized(phrase.trim());
  if (normalizedPhrase.length < 2) return [];
  const matches: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset < normalizedSource.length) {
    const start = normalizedSource.indexOf(normalizedPhrase, offset);
    if (start < 0) break;
    if (validBoundary(normalizedSource, start, normalizedPhrase.length, normalizedPhrase)) {
      matches.push({ start, end: start + normalizedPhrase.length });
    }
    offset = start + Math.max(1, normalizedPhrase.length);
  }
  return matches;
}

export function analyzePalettePrompt(
  prompt: string,
  terms: TermListItem[],
  channel: 'POSITIVE' | 'NEGATIVE' = 'POSITIVE',
  suppressedTermIds: ReadonlySet<string> = new Set(),
): PalettePromptAnalysis {
  const candidates: PalettePromptMatch[] = [];
  for (const term of terms) {
    if (suppressedTermIds.has(term.id)) continue;
    const expressions = [
      ...new Set(
        term.modelExpressions
          .map((item) => (channel === 'POSITIVE' ? item.positive : item.negative))
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    for (const expression of expressions) {
      for (const range of phraseMatches(prompt, expression)) {
        candidates.push({ ...range, kind: 'EXACT', term });
      }
    }
    const suggestions = [
      term.title,
      ...term.aliases,
      ...term.localizations.flatMap((item) => [item.title, ...item.aliases]),
    ]
      .map((value) => value.trim())
      .filter(
        (value, index, all) =>
          value &&
          all.indexOf(value) === index &&
          !expressions.some((expression) => normalized(value) === normalized(expression)),
      );
    for (const phrase of suggestions) {
      for (const range of phraseMatches(prompt, phrase)) {
        candidates.push({ ...range, kind: 'SUGGESTION', term });
      }
    }
  }

  const selected: PalettePromptMatch[] = [];
  for (const candidate of candidates.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'EXACT' ? -1 : 1;
    return right.end - right.start - (left.end - left.start) || left.start - right.start;
  })) {
    if (selected.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    selected.push(candidate);
  }
  selected.sort((left, right) => left.start - right.start || right.end - left.end);
  return {
    matches: selected,
    linkedTermIds: [...new Set(selected.filter((match) => match.kind === 'EXACT').map((match) => match.term.id))],
    suggestionTermIds: [
      ...new Set(selected.filter((match) => match.kind === 'SUGGESTION').map((match) => match.term.id)),
    ],
  };
}
