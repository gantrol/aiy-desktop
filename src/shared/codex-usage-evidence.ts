import type { CodexModelComparisonMetric, CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import type { CodexUsageModelBreakdown, CodexUsageTurnSpeedComparison } from '@/shared/contracts/codex-usage';
import { CODEX_MODEL_COMPARISON_METRIC_INDEX } from '@/shared/codex-model-comparison-distribution';

export function evidencePercent(part: number, total: number): number | null {
  return Number.isFinite(part) && Number.isFinite(total) && total > 0 && part >= 0 && part <= total
    ? (part / total) * 100
    : null;
}

export function recordedModeCoverage(models: readonly CodexUsageModelBreakdown[], totalTokens: number) {
  const classified = models.reduce((sum, row) => sum + row.totalTokens, 0);
  if (!Number.isFinite(classified) || classified > totalTokens || classified < 0)
    return { explicit: null, inferred: null, unknown: null };
  const unknown =
    totalTokens -
    classified +
    models.reduce((sum, row) => sum + (row.serviceTier === 'UNKNOWN' ? row.totalTokens : 0), 0);
  const inferred = models.reduce((sum, row) => sum + row.inferredServiceTierTokens, 0);
  const explicit = totalTokens - unknown - inferred;
  if (!Number.isFinite(inferred) || inferred < 0 || explicit < 0)
    return { explicit: null, inferred: null, unknown: null };
  return {
    explicit: evidencePercent(explicit, totalTokens),
    inferred: evidencePercent(inferred, totalTokens),
    unknown: evidencePercent(unknown, totalTokens),
  };
}

function quantile(sorted: readonly number[], probability: number): number | null {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = sorted[Math.floor(index)]!;
  return lower + (sorted[Math.ceil(index)]! - lower) * (index - Math.floor(index));
}

export function summarizeModelSamples(
  groups: readonly CodexModelComparisonRow[],
  metric: CodexModelComparisonMetric,
  retentionKnown = true,
) {
  const values: number[] = [];
  let eligible = 0;
  let retained = 0;
  for (const group of groups) {
    eligible += group.completedTurnCount;
    retained += group.samples?.length ?? 0;
    for (const sample of group.samples ?? []) {
      const value = sample[CODEX_MODEL_COMPARISON_METRIC_INDEX[metric]];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) values.push(value);
    }
  }
  values.sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  const total = values.length && Number.isFinite(sum) ? sum : null;
  return {
    values,
    eligible,
    retained,
    valid: values.length,
    missingMetric: Math.max(0, retained - values.length),
    notRetained: retentionKnown ? Math.max(0, eligible - retained) : null,
    incomplete: !retentionKnown || retained !== eligible || groups.some((group) => group.samples === null),
    total,
    mean: total === null ? null : total / values.length,
    p25: quantile(values, 0.25),
    p50: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.9),
  };
}

export type CodexSampleSummary = ReturnType<typeof summarizeModelSamples>;

/** Input is sorted by summarizeModelSamples; inclusive thresholds retain ties and zero values. */
export function observedThresholdShare(sorted: readonly number[], threshold: number | null) {
  if (threshold === null || !Number.isFinite(threshold) || threshold < 0 || !sorted.length) return null;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle]! <= threshold) low = middle + 1;
    else high = middle;
  }
  return { count: low, total: sorted.length, percent: (low / sorted.length) * 100 };
}

export function parseEvidenceThreshold(text: string, metric: CodexModelComparisonMetric): number | null {
  const trimmed = text.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
  const value = Number(trimmed) * (metric === 'durationMs' ? 1_000 : 1);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function comparisonGroupKey(group: CodexModelComparisonRow) {
  return JSON.stringify([group.model, group.serviceTier, group.reasoningEffort]);
}

export function defaultComparisonGroups(groups: readonly CodexModelComparisonRow[]) {
  const known = groups.filter(
    (group) =>
      group.completedTurnCount > 0 &&
      group.reasoningEffort &&
      group.reasoningEffort.toLowerCase() !== 'unknown' &&
      group.serviceTier !== 'UNKNOWN',
  );
  const fastGroups = new Map(
    known
      .filter((group) => group.serviceTier === 'FAST')
      .map((group) => [JSON.stringify([group.model, group.reasoningEffort]), group]),
  );
  const pairs = known
    .filter((group) => group.serviceTier === 'STANDARD')
    .flatMap((standard) => {
      const fast = fastGroups.get(JSON.stringify([standard.model, standard.reasoningEffort]));
      return fast ? [{ standard, fast }] : [];
    })
    .sort(
      (a, b) =>
        Math.min(b.standard.completedTurnCount, b.fast.completedTurnCount) -
          Math.min(a.standard.completedTurnCount, a.fast.completedTurnCount) ||
        comparisonGroupKey(a.standard).localeCompare(comparisonGroupKey(b.standard)),
    );
  if (pairs[0]) return [pairs[0].standard, pairs[0].fast] as const;
  const first = [...known].sort(
    (a, b) => b.completedTurnCount - a.completedTurnCount || comparisonGroupKey(a).localeCompare(comparisonGroupKey(b)),
  )[0];
  return [first ?? null, null] as const;
}

export function modelComparisonCautions(
  first: readonly CodexModelComparisonRow[],
  second: readonly CodexModelComparisonRow[],
) {
  const keys = new Set(first.map(comparisonGroupKey));
  const values = (rows: readonly CodexModelComparisonRow[], key: 'serviceTier' | 'reasoningEffort') =>
    [...new Set(rows.map((row) => row[key]))].sort();
  return {
    empty: !first.length || !second.length,
    mixed: first.length > 1 || second.length > 1,
    differentEffort:
      JSON.stringify(values(first, 'reasoningEffort')) !== JSON.stringify(values(second, 'reasoningEffort')),
    differentMode: JSON.stringify(values(first, 'serviceTier')) !== JSON.stringify(values(second, 'serviceTier')),
    overlap: second.some((group) => keys.has(comparisonGroupKey(group))),
    unknown: [...first, ...second].some(
      (group) =>
        !group.reasoningEffort || group.reasoningEffort.toLowerCase() === 'unknown' || group.serviceTier === 'UNKNOWN',
    ),
  };
}

/** Descriptive ratio only. A fixed sample-count threshold cannot establish comparability. */
export function observedTaskDurationRatio(comparison: CodexUsageTurnSpeedComparison): number | null {
  const { standard, fast } = comparison;
  if (
    !standard.completedTurnCount ||
    !fast.completedTurnCount ||
    standard.medianDurationMs === null ||
    fast.medianDurationMs === null ||
    standard.medianDurationMs <= 0 ||
    fast.medianDurationMs <= 0 ||
    !Number.isFinite(standard.medianDurationMs) ||
    !Number.isFinite(fast.medianDurationMs) ||
    !comparison.reasoningEffort ||
    comparison.reasoningEffort.toLowerCase() === 'unknown'
  )
    return null;
  const ratio = standard.medianDurationMs / fast.medianDurationMs;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export function bestSupportedSpeedComparison(comparisons: readonly CodexUsageTurnSpeedComparison[]) {
  return (
    [...comparisons].sort((a, b) => {
      const support = (row: CodexUsageTurnSpeedComparison) =>
        Math.min(row.standard.completedTurnCount, row.fast.completedTurnCount);
      return (
        support(b) - support(a) || a.model.localeCompare(b.model) || a.reasoningEffort.localeCompare(b.reasoningEffort)
      );
    })[0] ?? null
  );
}

/** Bounded drawing only; tables, threshold counts and exports always use all retained values. */
export function displaySampleValues(sorted: readonly number[], limit = 200): number[] {
  const count = Math.max(2, Math.min(2_000, Math.floor(limit) || 200));
  if (sorted.length <= count) return [...sorted];
  return Array.from({ length: count }, (_, index) => sorted[Math.round((index * (sorted.length - 1)) / (count - 1))]!);
}

export function empiricalSteps(sorted: readonly number[], limit = 200) {
  return [...new Set(displaySampleValues(sorted, limit))].map((value) => ({
    value,
    percent: observedThresholdShare(sorted, value)!.percent,
  }));
}
