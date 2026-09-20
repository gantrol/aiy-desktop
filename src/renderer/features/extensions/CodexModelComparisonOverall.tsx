import type { CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import { summarizeCodexModelComparisonCosts } from '@/shared/codex-model-comparison-summary';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import type { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['modelComparison'];

function ratio(valueA: number | null, valueB: number | null) {
  if (valueA === null || valueB === null || valueA <= 0 || valueB < 0) return null;
  const result = valueB / valueA;
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function percentagePointDifference(valueA: number | null, valueB: number | null) {
  if (valueA === null || valueB === null) return null;
  const result = valueB - valueA;
  return Number.isFinite(result) ? result : null;
}

function formatDifference(value: number | null, numbers: Intl.NumberFormat, suffix: string) {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${numbers.format(value)}${suffix}`;
}

function formatRatio(value: number | null, numbers: Intl.NumberFormat) {
  return value === null ? '—' : `${numbers.format(value)}×`;
}

function formatCoverage(
  pricedTokens: number,
  totalTokens: number,
  coveragePercent: number | null,
  tokens: Intl.NumberFormat,
  numbers: Intl.NumberFormat,
) {
  if (coveragePercent === null) return '—';
  return `${tokens.format(pricedTokens)} / ${tokens.format(totalTokens)} · ${numbers.format(coveragePercent)}%`;
}

export function CodexModelComparisonOverall({
  groups,
  labels,
  numbers,
  tokens,
  money,
}: {
  groups: readonly [readonly CodexModelComparisonRow[], readonly CodexModelComparisonRow[]];
  labels: Labels;
  numbers: Intl.NumberFormat;
  tokens: Intl.NumberFormat;
  money: Intl.NumberFormat;
}) {
  const summaries = [
    summarizeCodexModelComparisonCosts(groups[0]),
    summarizeCodexModelComparisonCosts(groups[1]),
  ] as const;
  const [summaryA, summaryB] = summaries;
  const rows = [
    {
      label: labels.overall.inputCacheShare,
      values: summaries.map((summary) =>
        summary.cachedInputPercent === null ? '—' : `${numbers.format(summary.cachedInputPercent)}%`,
      ),
      comparison: formatDifference(
        percentagePointDifference(summaryA.cachedInputPercent, summaryB.cachedInputPercent),
        numbers,
        labels.overall.percentagePoint,
      ),
    },
    {
      label: labels.overall.outputShare,
      values: summaries.map((summary) =>
        summary.outputPercent === null ? '—' : `${numbers.format(summary.outputPercent)}%`,
      ),
      comparison: formatDifference(
        percentagePointDifference(summaryA.outputPercent, summaryB.outputPercent),
        numbers,
        labels.overall.percentagePoint,
      ),
    },
    {
      label: labels.overall.apiPerMillion,
      values: summaries.map((summary) =>
        summary.apiEquivalentUsdPerMillionTokens === null
          ? '—'
          : money.format(summary.apiEquivalentUsdPerMillionTokens),
      ),
      comparison: formatRatio(
        ratio(summaryA.apiEquivalentUsdPerMillionTokens, summaryB.apiEquivalentUsdPerMillionTokens),
        numbers,
      ),
    },
    {
      label: labels.overall.creditsPerMillion,
      values: summaries.map((summary) =>
        summary.codexCreditsPerMillionTokens === null ? '—' : numbers.format(summary.codexCreditsPerMillionTokens),
      ),
      comparison: formatRatio(
        ratio(summaryA.codexCreditsPerMillionTokens, summaryB.codexCreditsPerMillionTokens),
        numbers,
      ),
    },
    {
      label: labels.overall.apiCoverage,
      values: summaries.map((summary) =>
        formatCoverage(summary.apiPricedTokens, summary.totalTokens, summary.apiCoveragePercent, tokens, numbers),
      ),
      comparison: '—',
    },
    {
      label: labels.overall.creditsCoverage,
      values: summaries.map((summary) =>
        formatCoverage(summary.creditPricedTokens, summary.totalTokens, summary.creditCoveragePercent, tokens, numbers),
      ),
      comparison: '—',
    },
  ];
  return (
    <section className="grid min-w-0 gap-2" aria-label={labels.overall.title}>
      <div className="flex items-center gap-1 text-sm font-medium">
        <span>{labels.overall.title}</span>
        <CodexUsageEvidenceHelp label={labels.overall.note}>{labels.overall.note}</CodexUsageEvidenceHelp>
      </div>
      <div className="min-w-0 max-w-full overflow-auto border-y">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{labels.overall.metric}</TableHead>
              <TableHead numeric>{labels.compareA}</TableHead>
              <TableHead numeric>{labels.compareB}</TableHead>
              <TableHead numeric>{labels.overall.comparison}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableHead scope="row">{row.label}</TableHead>
                <TableCell numeric>{row.values[0]}</TableCell>
                <TableCell numeric>{row.values[1]}</TableCell>
                <TableCell numeric>{row.comparison}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
