import type {
  CodexModelComparisonDistribution,
  CodexModelComparisonMetric,
} from '@/shared/contracts/codex-model-comparison';

export const CODEX_MODEL_COMPARISON_METRIC_INDEX = {
  durationMs: 1,
  requests: 2,
  totalTokens: 3,
  outputTokens: 4,
  apiEquivalentUsd: 5,
  codexCredits: 6,
} as const satisfies Record<CodexModelComparisonMetric, number>;

export function codexModelComparisonDistribution(values: (number | null)[]): CodexModelComparisonDistribution | null {
  const sorted = values.filter((value): value is number => value !== null).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return {
    sampleCount: sorted.length,
    percentiles: Array.from({ length: 101 }, (_, percentile) => {
      const position = ((sorted.length - 1) * percentile) / 100;
      const lower = Math.floor(position);
      const fraction = position - lower;
      return sorted[lower]! + (sorted[Math.ceil(position)]! - sorted[lower]!) * fraction;
    }),
  };
}
