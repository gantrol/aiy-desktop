import type {
  CodexModelComparisonDistribution,
  CodexModelComparisonRow,
} from '@/shared/contracts/codex-model-comparison';
import {
  CODEX_MODEL_COMPARISON_METRIC_INDEX,
  codexModelComparisonDistribution,
} from '@/shared/codex-model-comparison-distribution';

export type CodexDurationComparisonRows = readonly [CodexModelComparisonRow | null, CodexModelComparisonRow | null];

function upperDurationFence(distribution: CodexModelComparisonDistribution) {
  const lowerQuartile = distribution.percentiles[25]!;
  const upperQuartile = distribution.percentiles[75]!;
  const interquartileRange = upperQuartile - lowerQuartile;
  // A zero IQR must not turn tiny differences between repeated timings into
  // extreme outliers. Fall back to a conservative spread of Q3 (at least 1 s).
  const spread = interquartileRange > 0 ? interquartileRange : Math.max(upperQuartile, 1_000);
  return Math.min(Number.MAX_VALUE, upperQuartile + 3 * spread);
}

/** Filter this comparison only; stored samples and the original report stay intact. */
export function codexTurnDurationComparison(rows: CodexDurationComparisonRows) {
  const groups = rows.flatMap((row) => {
    const distribution = row?.distributions?.durationMs;
    if (!row || !distribution) return [];
    const values = (row.samples ?? [])
      .map((sample) => sample[CODEX_MODEL_COMPARISON_METRIC_INDEX.durationMs])
      .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    return [{ row, distribution, values }];
  });
  if (!groups.length) return { status: 'empty' } as const;
  // Reconstructing a sample from its 101 percentile points would give false
  // counts and medians. Old or incomplete reports need their individual turns.
  if (groups.some((group) => group.values.length !== group.distribution.sampleCount))
    return { status: 'missing-samples' } as const;

  // Both modes use the more permissive outer fence, independent of their sample
  // counts. This avoids cutting a whole slower cohort at the faster one's fence.
  const upperFenceMs = Math.max(...groups.map((group) => upperDurationFence(group.distribution)));
  const series = groups.map(({ row, distribution, values }) => {
    const retained = values.filter((value) => value <= upperFenceMs);
    const excludedCount = values.length - retained.length;
    return {
      row,
      excludedCount,
      distribution: excludedCount ? codexModelComparisonDistribution(retained) : distribution,
    };
  });
  const standard = series.find((item) => item.row.serviceTier === 'STANDARD');
  const fast = series.find((item) => item.row.serviceTier === 'FAST');
  const standardMedian = standard?.distribution?.percentiles[50];
  const fastMedian = fast?.distribution?.percentiles[50];
  const medianChange =
    standard &&
    fast &&
    standard.row.model === fast.row.model &&
    standard.row.reasoningEffort === fast.row.reasoningEffort &&
    standardMedian !== undefined &&
    standardMedian > 0 &&
    fastMedian !== undefined
      ? fastMedian / standardMedian - 1
      : null;
  return {
    status: 'ready',
    series,
    upperFenceMs,
    medianChange: medianChange !== null && Number.isFinite(medianChange) ? medianChange : null,
  } as const;
}
