import type { CodexModelComparisonMetric, CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import { CODEX_MODEL_COMPARISON_METRIC_INDEX } from '@/shared/codex-model-comparison-distribution';

const CONFIGURATION_COLORS = [
  'var(--success)',
  'var(--warning)',
  'var(--info)',
  'var(--destructive)',
  'var(--selected-foreground)',
  'var(--foreground-secondary)',
  'color-mix(in oklch, var(--success) 58%, var(--warning))',
  'color-mix(in oklch, var(--info) 58%, var(--success))',
  'color-mix(in oklch, var(--destructive) 58%, var(--selected-foreground))',
  'color-mix(in oklch, var(--warning) 58%, var(--destructive))',
  'color-mix(in oklch, var(--success) 58%, var(--selected-foreground))',
  'color-mix(in oklch, var(--info) 58%, var(--warning))',
] as const;

export interface CodexModelChartConfiguration {
  key: string;
  label: string;
  color: string;
}

export interface CodexModelChartGroup {
  key: string;
  configuration: CodexModelChartConfiguration;
  values: number[];
}

export interface CodexModelChartSample {
  key: string;
  configuration: CodexModelChartConfiguration;
  value: number;
  percentile: number;
  cumulativePercent: number;
}

function configurationKey(group: CodexModelComparisonRow) {
  return JSON.stringify([group.model, group.reasoningEffort]);
}

function groupMetricValues(group: CodexModelComparisonRow, metric: CodexModelComparisonMetric) {
  const index = CODEX_MODEL_COMPARISON_METRIC_INDEX[metric];
  return (group.samples ?? [])
    .map((sample) => sample[index])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
}

export function codexModelComparisonChartData(
  sides: readonly [readonly CodexModelComparisonRow[], readonly CodexModelComparisonRow[]],
  metric: CodexModelComparisonMetric,
  unknownEffort: string,
) {
  const configurationRows = [...new Map(sides.flat().map((group) => [configurationKey(group), group])).values()].sort(
    (a, b) => a.model.localeCompare(b.model) || (a.reasoningEffort ?? '').localeCompare(b.reasoningEffort ?? ''),
  );
  const configurations = configurationRows.map((group, index): CodexModelChartConfiguration => ({
    key: configurationKey(group),
    label: `${group.model} · ${group.reasoningEffort ?? unknownEffort}`,
    color: CONFIGURATION_COLORS[index % CONFIGURATION_COLORS.length]!,
  }));
  const configurationByKey = new Map(configurations.map((configuration) => [configuration.key, configuration]));
  const chartSide = (groups: readonly CodexModelComparisonRow[]) =>
    groups.map((group): CodexModelChartGroup => ({
      key: JSON.stringify([group.model, group.reasoningEffort, group.serviceTier]),
      configuration: configurationByKey.get(configurationKey(group))!,
      values: groupMetricValues(group, metric),
    }));
  return { configurations, sides: [chartSide(sides[0]), chartSide(sides[1])] as const };
}

/** Bound SVG work while preserving each sampled point's configuration and rank in its side. */
export function displayCodexModelChartSamples(groups: readonly CodexModelChartGroup[], limit = 200) {
  const ordered = groups
    .flatMap((group) =>
      group.values.map((value, index) => ({
        key: `${group.key}:${index}`,
        configuration: group.configuration,
        value,
      })),
    )
    .sort((a, b) => a.value - b.value || a.configuration.key.localeCompare(b.configuration.key));
  const count = Math.max(2, Math.min(2_000, Math.floor(limit) || 200));
  const indexes =
    ordered.length <= count
      ? ordered.map((_, index) => index)
      : Array.from({ length: count }, (_, index) => Math.round((index * (ordered.length - 1)) / (count - 1)));
  return indexes.map((index): CodexModelChartSample => ({
    ...ordered[index]!,
    percentile: ordered.length === 1 ? 50 : (index / (ordered.length - 1)) * 100,
    cumulativePercent: ((index + 1) / ordered.length) * 100,
  }));
}
