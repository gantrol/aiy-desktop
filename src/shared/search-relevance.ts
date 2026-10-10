/** Trial lower bounds for levels 2–5; these labels are not probabilities or result filters. */
export const searchRelevanceThresholds = {
  document: [0.65, 0.75, 0.85, 0.93],
  image: [0.68, 0.77, 0.86, 0.94],
  videoFrame: [0.68, 0.77, 0.86, 0.94],
  videoText: [0.7, 0.79, 0.87, 0.94],
} as const;

/** Main-process weak-match flags use the same first boundary as the renderer. */
export const searchRelevanceBoundaries = {
  document: searchRelevanceThresholds.document[0],
  image: searchRelevanceThresholds.image[0],
  videoFrame: searchRelevanceThresholds.videoFrame[0],
  videoText: searchRelevanceThresholds.videoText[0],
} as const;

export type SearchRelevanceChannel = keyof typeof searchRelevanceThresholds;
export type SearchRelevanceLevel = 'LOW' | 'BORDERLINE' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';

/** Classify directly, with insufficient evidence taking precedence over the cosine score. */
export function searchRelevanceLevel(
  score: number | null | undefined,
  channel: SearchRelevanceChannel,
  borderline = false,
): SearchRelevanceLevel | null {
  if (borderline) return 'LOW';
  if (score == null || !Number.isFinite(score)) return null;
  const [borderlineThreshold, moderateThreshold, highThreshold, veryHighThreshold] = searchRelevanceThresholds[channel];
  if (score < borderlineThreshold) return 'LOW';
  if (score < moderateThreshold) return 'BORDERLINE';
  if (score < highThreshold) return 'MODERATE';
  if (score < veryHighThreshold) return 'HIGH';
  return 'VERY_HIGH';
}
