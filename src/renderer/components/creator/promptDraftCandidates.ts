import type { CodexAssistPromptNodeInput, CreatorPromptNodeInput, TermListItem } from '@/shared/contracts';
import { termFacetValueIds } from '@/shared/term-localization';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';

interface PromptDraftCandidateInput {
  terms: readonly TermListItem[];
  selectedTermIds: readonly string[];
  excludedTermIds?: readonly string[];
  selectedFacetValueIds: readonly string[];
  signalTexts: readonly string[];
  limit?: number;
}

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function tokens(value: string) {
  const source = normalized(value);
  const result = new Set(source.match(/[a-z0-9][a-z0-9_-]+/g) ?? []);
  for (const sequence of source.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (sequence.length === 1) result.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) result.add(sequence.slice(index, index + 2));
  }
  return result;
}

function overlapScore(query: ReadonlySet<string>, value: string, weight: number) {
  let score = 0;
  for (const token of tokens(value)) if (query.has(token)) score += weight;
  return score;
}

/** Small deterministic local retrieval pass. The model sees only these frozen
 * candidates and therefore cannot invent dictionary references. */
export function rankPromptDraftTermCandidates({
  terms,
  selectedTermIds,
  excludedTermIds = [],
  selectedFacetValueIds,
  signalTexts,
  limit = 32,
}: PromptDraftCandidateInput) {
  const selected = new Set(selectedTermIds);
  const excluded = new Set(excludedTermIds);
  const selectedFacets = new Set(selectedFacetValueIds);
  const signal = normalized(signalTexts.filter(Boolean).join(' '));
  const queryTokens = tokens(signal);
  return terms
    .flatMap((term) => {
      if (selected.has(term.id) || excluded.has(term.id)) return [];
      const names = [term.title, ...term.localizations.map((item) => item.title), ...term.aliases].filter(Boolean);
      let score = names.reduce((total, value) => total + overlapScore(queryTokens, value, 8), 0);
      score += overlapScore(queryTokens, term.modelExpressions.map((item) => item.positive).join(' '), 4);
      score += overlapScore(queryTokens, term.definition, 2);
      score += overlapScore(
        queryTokens,
        term.classifications.map((classification) => classification.name).join(' '),
        3,
      );
      score += termFacetValueIds(term).reduce((total, facetId) => total + (selectedFacets.has(facetId) ? 5 : 0), 0);
      if (signal && names.some((name) => signal.includes(normalized(name)))) score += 30;
      if (score <= 0) return [];
      return [{ term, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.term.editorialState === 'APPROVED') - Number(left.term.editorialState === 'APPROVED') ||
        left.term.stableKey.localeCompare(right.term.stableKey),
    )
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map(({ term }) => term);
}

export function buildCreatorAssistPromptNodes(
  nodes: readonly CreatorPromptNodeInput[],
  selectedTerms: readonly TermListItem[],
  appliedPalettes: readonly AppliedWordPalette[],
): CodexAssistPromptNodeInput[] {
  const terms = new Map(selectedTerms.map((term) => [term.id, term] as const));
  const palettes = new Map(appliedPalettes.map((reference) => [reference.palette.id, reference] as const));
  return nodes.flatMap((node): CodexAssistPromptNodeInput[] => {
    if (node.kind === 'TEXT') return node.text ? [{ kind: 'TEXT', text: node.text }] : [];
    if (node.kind === 'TERM') {
      const term = terms.get(node.termId);
      return term ? [{ kind: 'TERM', termId: term.id, termRevisionId: term.termRevisionId }] : [];
    }
    const reference = palettes.get(node.paletteId);
    return reference
      ? [
          {
            kind: 'RECIPE',
            paletteId: reference.palette.id,
            paletteRevisionId: reference.revision.id,
          },
        ]
      : [];
  });
}
