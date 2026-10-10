import { searchRelevanceBoundaries } from '@/shared/search-relevance';

/** Labels preserve raw cosine scores and never remove candidates or imply a probability. */
export function isBorderline(score: number, kind: 'document' | 'image') {
  // Trial labels favor recall; see the calibration scope in docs/image-search.md.
  return score < searchRelevanceBoundaries[kind];
}

/** Discount a passage's response to the task prefix alone, without hiding it or changing its cosine score. */
export function rankDocumentSimilarity(score: number, background: number) {
  // Partial subtraction preserves focused matches better than removing the entire background response.
  return score - 0.75 * background;
}

/** Empty editor scaffolding and invisible formatting do not provide semantic evidence. */
export function hasSearchContent(value: string) {
  return /[\p{L}\p{N}\p{S}]/u.test(value.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ''));
}
