import { useCallback, useMemo, useState } from 'react';
import { InfoIcon } from 'lucide-react';
import type {
  CodexUsageSessionLengthAnalysis,
  CodexUsageSessionLengthBucket,
  CodexUsageSessionLengthComparison,
  CodexUsageSessionLengthRange,
  CodexUsageSessionSource,
} from '@/shared/contracts';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';

const STORAGE_KEY = 'aiy.codexUsageInvestigator.detailedStatistics';
const SESSION_SOURCES: CodexUsageSessionSource[] = ['USER_DIRECT', 'USER_FORK', 'SUBAGENT'];

export interface CodexUsageDetailedStatisticsLabels {
  option: string;
  title: string;
  sessionSource: string;
  sources: Record<CodexUsageSessionSource, string>;
  modelComparison: string;
  rangeCompleteSessions: string;
  tokenComparableSessions: string;
  overallApiPricedSessions: string;
  tokenComparisonCoverage: string;
  overallLowestTokenRange: string;
  overallLowestApiRange: string;
  overallSustainedIncrease: string;
  newSessionRecommendation: string;
  comparisonGroups: string;
  insufficientEvidence: string;
  apiNormalizationNote: string;
  cacheWriteNote: string;
  sessionLengthNote: string;
  subagentSessionLengthNote: string;
  sessions: string;
  totalChatTurns: string;
  totalOwnedChatTurns: string;
  sessionTurnsPercentiles: string;
  ownedSessionTurnsPercentiles: string;
  averageContextCompactions: string;
  apiPricedSessions: string;
  sessionLength: string;
  ownedSessionLength: string;
  sessionTurnDistribution: string;
  lowestTokenRange: string;
  lowestApiCostRange: string;
  sustainedIncrease: string;
  onsetContextRange: string;
  peakContextRange: string;
  medianUncachedInput: string;
  medianCachedInput: string;
  medianCacheWriteInput: string;
  medianOutput: string;
  medianReasoningOutput: string;
  medianTotal: string;
  medianApiCost: string;
  pricingCoverage: string;
}

function storedPreference() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistPreference(value: boolean) {
  try {
    if (value) globalThis.localStorage?.setItem(STORAGE_KEY, 'true');
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // The preference remains valid for this renderer session when storage is unavailable.
  }
}

export function useCodexUsageDetailedStatisticsPreference() {
  const [enabled, setEnabledState] = useState(storedPreference);
  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    persistPreference(value);
  }, []);
  return { enabled, setEnabled };
}

export function CodexUsageDetailedStatisticsToggle({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onCheckedChange(value: boolean): void;
}) {
  return (
    <div className="flex h-8 items-center gap-2 border-l pl-3">
      <Checkbox
        id="codex-usage-detailed-statistics"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label htmlFor="codex-usage-detailed-statistics" className="text-xs">
        {label}
      </Label>
    </div>
  );
}

function rangeLabel(range: CodexUsageSessionLengthRange) {
  if (range.maximumTurns === range.minimumTurns) return String(range.minimumTurns);
  return range.maximumTurns === null ? `${range.minimumTurns}+` : `${range.minimumTurns}–${range.maximumTurns}`;
}

function sourceSummaryLabels(source: CodexUsageSessionSource, labels: CodexUsageDetailedStatisticsLabels) {
  if (source === 'SUBAGENT') {
    return {
      totalChatTurns: labels.totalOwnedChatTurns,
      sessionTurnsPercentiles: labels.ownedSessionTurnsPercentiles,
    };
  }
  return {
    totalChatTurns: labels.totalChatTurns,
    sessionTurnsPercentiles: labels.sessionTurnsPercentiles,
  };
}

function comparisonKey(comparison: CodexUsageSessionLengthComparison) {
  return comparison.model;
}

function sameRange(left: CodexUsageSessionLengthRange, right: CodexUsageSessionLengthRange) {
  return left.minimumTurns === right.minimumTurns && left.maximumTurns === right.maximumTurns;
}

function contextRange(bucket: CodexUsageSessionLengthBucket, tokens: Intl.NumberFormat) {
  return `${tokens.format(bucket.percentile25PeakContextTokens)}–${tokens.format(bucket.percentile75PeakContextTokens)}`;
}

function sessionTurnDistribution(bucket: CodexUsageSessionLengthBucket, numbers: Intl.NumberFormat) {
  const distribution = bucket.sessionTurnDistribution.length
    ? bucket.sessionTurnDistribution
    : bucket.minimumTurns === bucket.maximumTurns
      ? [{ chatTurns: bucket.minimumTurns, sessionCount: bucket.sessionCount }]
      : [];
  return distribution.length
    ? distribution
        .map(({ chatTurns, sessionCount }) => `${numbers.format(chatTurns)}×${numbers.format(sessionCount)}`)
        .join(' · ')
    : '—';
}

function formatAverageContextCompactions(
  comparison: CodexUsageSessionLengthComparison | null,
  numbers: Intl.NumberFormat,
) {
  const average = comparison?.averageContextCompactions;
  return average === null || average === undefined ? '—' : numbers.format(average);
}

function TooltipLabel({ label, content }: { label: string; content: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="inline-flex cursor-help" aria-label={label}>
            <InfoIcon className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{content}</TooltipContent>
      </Tooltip>
    </span>
  );
}

interface FormattedCost {
  display: string;
  precise: string;
}

function CostValue({ cost }: { cost: FormattedCost | null }) {
  if (!cost) return '—';
  if (cost.display === cost.precise) return cost.display;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help underline decoration-dotted underline-offset-4"
          aria-label={cost.precise}
        >
          {cost.display}
        </button>
      </TooltipTrigger>
      <TooltipContent>{cost.precise}</TooltipContent>
    </Tooltip>
  );
}

type Consensus = {
  range: CodexUsageSessionLengthRange | null;
  supportingComparisons: number;
  eligibleComparisons: number;
};

function consensusRange(comparisons: readonly CodexUsageSessionLengthComparison[], kind: 'TOKEN' | 'API'): Consensus {
  const votes = new Map<string, { range: CodexUsageSessionLengthRange; count: number }>();
  let eligibleComparisons = 0;
  for (const comparison of comparisons) {
    const buckets = comparison.buckets.filter((bucket) =>
      kind === 'TOKEN'
        ? bucket.sessionCount >= 5
        : bucket.apiPricedSessionCount >= 5 && bucket.medianApiEquivalentUsdPerTurn !== null,
    );
    if (buckets.length < 2) continue;
    eligibleComparisons += 1;
    const lowest = Math.min(
      ...buckets.map((bucket) =>
        kind === 'TOKEN' ? bucket.medianTotalTokensPerTurn : (bucket.medianApiEquivalentUsdPerTurn ?? Infinity),
      ),
    );
    for (const bucket of buckets) {
      const cost = kind === 'TOKEN' ? bucket.medianTotalTokensPerTurn : bucket.medianApiEquivalentUsdPerTurn;
      if (cost === null || Math.abs(cost - lowest) > Math.max(1e-12, Math.abs(lowest) * 1e-12)) continue;
      const key = `${bucket.minimumTurns}:${bucket.maximumTurns ?? 'MAX'}`;
      const vote = votes.get(key);
      votes.set(key, { range: bucket, count: (vote?.count ?? 0) + 1 });
    }
  }
  const ordered = [...votes.values()].sort((left, right) => right.count - left.count);
  const first = ordered[0];
  const second = ordered[1];
  return {
    range: first && first.count !== second?.count ? first.range : null,
    supportingComparisons: first?.count ?? 0,
    eligibleComparisons,
  };
}

function sustainedIncreaseConsensus(comparisons: readonly CodexUsageSessionLengthComparison[]): Consensus {
  const votes = new Map<string, { range: CodexUsageSessionLengthRange; count: number }>();
  let eligibleComparisons = 0;
  for (const comparison of comparisons) {
    const hasEligibleWindow = comparison.buckets.some(
      (_, index, buckets) =>
        buckets.slice(index, index + 3).length === 3 &&
        buckets
          .slice(index, index + 3)
          .every((bucket) => bucket.apiPricedSessionCount >= 5 && bucket.medianApiEquivalentUsdPerTurn !== null),
    );
    if (!hasEligibleWindow) continue;
    eligibleComparisons += 1;
    const signal = comparison.sustainedApiCostIncrease;
    if (!signal) continue;
    const key = `${signal.minimumTurns}:${signal.maximumTurns ?? 'MAX'}`;
    const vote = votes.get(key);
    votes.set(key, { range: signal, count: (vote?.count ?? 0) + 1 });
  }
  const ordered = [...votes.values()].sort((left, right) => right.count - left.count);
  const first = ordered[0];
  const second = ordered[1];
  return {
    range: first && first.count !== second?.count ? first.range : null,
    supportingComparisons: first?.count ?? 0,
    eligibleComparisons,
  };
}

function SessionLengthBucketTable({
  comparison,
  labels,
  tokens,
  numbers,
  formatCost,
}: {
  comparison: CodexUsageSessionLengthComparison;
  labels: CodexUsageDetailedStatisticsLabels;
  tokens: Intl.NumberFormat;
  numbers: Intl.NumberFormat;
  formatCost(value: number | null): FormattedCost | null;
}) {
  const isSubagent = comparison.source === 'SUBAGENT';
  const sessionLengthLabel = isSubagent ? labels.ownedSessionLength : labels.sessionLength;
  const sessionLengthNote = isSubagent
    ? `${labels.subagentSessionLengthNote} ${labels.sessionLengthNote}`
    : labels.sessionLengthNote;
  return (
    <div className="overflow-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <TooltipLabel label={sessionLengthLabel} content={sessionLengthNote} />
            </TableHead>
            <TableHead numeric>{labels.sessions}</TableHead>
            <TableHead numeric>{labels.averageContextCompactions}</TableHead>
            <TableHead numeric>{labels.medianUncachedInput}</TableHead>
            <TableHead numeric>{labels.medianCachedInput}</TableHead>
            <TableHead numeric>
              <TooltipLabel label={labels.medianCacheWriteInput} content={labels.cacheWriteNote} />
            </TableHead>
            <TableHead numeric>{labels.medianOutput}</TableHead>
            <TableHead numeric>{labels.medianReasoningOutput}</TableHead>
            <TableHead numeric>{labels.medianTotal}</TableHead>
            <TableHead numeric>
              <TooltipLabel label={labels.medianApiCost} content={labels.apiNormalizationNote} />
            </TableHead>
            <TableHead numeric>{labels.peakContextRange}</TableHead>
            <TableHead numeric>{labels.apiPricedSessions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparison.buckets.map((bucket) => {
            const isLowestToken = comparison.lowestMedianTokenRanges.some((range) => sameRange(bucket, range));
            const isIncreaseOnset = Boolean(
              comparison.sustainedApiCostIncrease && sameRange(bucket, comparison.sustainedApiCostIncrease),
            );
            return (
              <TableRow key={`${bucket.minimumTurns}:${bucket.maximumTurns ?? 'MAX'}`}>
                <TableCell
                  className={cn(
                    'font-mono text-xs',
                    isLowestToken && 'bg-accent/50 font-semibold',
                    isIncreaseOnset && 'text-primary ring-1 ring-inset ring-primary/30',
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="cursor-help underline decoration-dotted underline-offset-4"
                        aria-label={`${sessionLengthLabel} ${rangeLabel(bucket)}`}
                      >
                        {rangeLabel(bucket)}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-80">
                      <div className="grid gap-1">
                        <div>{labels.sessionTurnDistribution}</div>
                        <div className="font-mono">{sessionTurnDistribution(bucket, numbers)}</div>
                        {isSubagent && <div>{labels.subagentSessionLengthNote}</div>}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell numeric>{numbers.format(bucket.sessionCount)}</TableCell>
                <TableCell numeric>
                  {bucket.averageContextCompactions === null ? '—' : numbers.format(bucket.averageContextCompactions)}
                </TableCell>
                <TableCell numeric>{tokens.format(bucket.medianUncachedInputTokensPerTurn)}</TableCell>
                <TableCell numeric>{tokens.format(bucket.medianCachedInputTokensPerTurn)}</TableCell>
                <TableCell numeric>{tokens.format(bucket.medianCacheWriteInputTokensPerTurn)}</TableCell>
                <TableCell numeric>{tokens.format(bucket.medianOutputTokensPerTurn)}</TableCell>
                <TableCell numeric>{tokens.format(bucket.medianReasoningOutputTokensPerTurn)}</TableCell>
                <TableCell numeric>{tokens.format(bucket.medianTotalTokensPerTurn)}</TableCell>
                <TableCell numeric>
                  <CostValue cost={formatCost(bucket.medianApiEquivalentUsdPerTurn)} />
                </TableCell>
                <TableCell numeric>{contextRange(bucket, tokens)}</TableCell>
                <TableCell numeric>
                  {numbers.format(bucket.apiPricedSessionCount)}/{numbers.format(bucket.sessionCount)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function OverallSessionLengthSignals({
  tokenConsensus,
  apiConsensus,
  sustainedConsensus,
  labels,
  numbers,
}: {
  tokenConsensus: Consensus;
  apiConsensus: Consensus;
  sustainedConsensus: Consensus;
  labels: CodexUsageDetailedStatisticsLabels;
  numbers: Intl.NumberFormat;
}) {
  return (
    <dl className="grid grid-cols-2 divide-x border-y sm:grid-cols-4">
      <div className="grid gap-1 bg-accent/30 px-4 py-3">
        <dt className="text-xs text-muted-foreground">{labels.overallLowestTokenRange}</dt>
        <dd className="text-2xl font-semibold tabular-nums">
          {tokenConsensus.range ? rangeLabel(tokenConsensus.range) : '—'}
        </dd>
        <dd className="text-[11px] text-muted-foreground">
          {numbers.format(tokenConsensus.supportingComparisons)}/{numbers.format(tokenConsensus.eligibleComparisons)}{' '}
          {labels.comparisonGroups}
        </dd>
      </div>
      <div className="grid gap-1 px-4 py-3">
        <dt className="text-xs text-muted-foreground">
          <TooltipLabel label={labels.overallLowestApiRange} content={labels.apiNormalizationNote} />
        </dt>
        <dd className="text-2xl font-semibold tabular-nums">
          {apiConsensus.range ? rangeLabel(apiConsensus.range) : '—'}
        </dd>
        <dd className="text-[11px] text-muted-foreground">
          {numbers.format(apiConsensus.supportingComparisons)}/{numbers.format(apiConsensus.eligibleComparisons)}{' '}
          {labels.comparisonGroups}
        </dd>
      </div>
      <div className="grid gap-1 px-4 py-3">
        <dt className="text-xs text-muted-foreground">{labels.overallSustainedIncrease}</dt>
        <dd className="text-2xl font-semibold tabular-nums">
          {sustainedConsensus.range ? rangeLabel(sustainedConsensus.range) : '—'}
        </dd>
        <dd className="text-[11px] text-muted-foreground">
          {numbers.format(sustainedConsensus.supportingComparisons)}/
          {numbers.format(sustainedConsensus.eligibleComparisons)} {labels.comparisonGroups}
        </dd>
      </div>
      <div className="grid gap-1 px-4 py-3">
        <dt className="text-xs text-muted-foreground">{labels.newSessionRecommendation}</dt>
        <dd className="text-lg font-semibold tabular-nums">
          {sustainedConsensus.range && sustainedConsensus.supportingComparisons >= 2
            ? rangeLabel(sustainedConsensus.range)
            : labels.insufficientEvidence}
        </dd>
      </div>
    </dl>
  );
}

export function CodexUsageSessionLengthResults({
  analysis,
  labels,
  tokens,
  numbers,
  numberLocale,
}: {
  analysis: CodexUsageSessionLengthAnalysis;
  labels: CodexUsageDetailedStatisticsLabels;
  tokens: Intl.NumberFormat;
  numbers: Intl.NumberFormat;
  numberLocale: string;
}) {
  const money = useMemo(
    () => ({
      regular: new Intl.NumberFormat(numberLocale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
      }),
      small: new Intl.NumberFormat(numberLocale, {
        style: 'currency',
        currency: 'USD',
        maximumSignificantDigits: 3,
      }),
      precise: new Intl.NumberFormat(numberLocale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 12,
      }),
    }),
    [numberLocale],
  );
  const [selectedSource, setSelectedSource] = useState<CodexUsageSessionSource>('USER_DIRECT');
  const [selectedComparisonKey, setSelectedComparisonKey] = useState('');
  const sourceComparisons = analysis.comparisons.filter((comparison) => comparison.source === selectedSource);
  const selectedComparison =
    sourceComparisons.find((comparison) => comparisonKey(comparison) === selectedComparisonKey) ??
    sourceComparisons[0] ??
    null;
  const overallApiPricedSessions = analysis.comparisons.reduce(
    (sum, comparison) => sum + comparison.apiPricedSessionCount,
    0,
  );
  const tokenConsensus = consensusRange(analysis.comparisons, 'TOKEN');
  const apiConsensus = consensusRange(analysis.comparisons, 'API');
  const sustainedConsensus = sustainedIncreaseConsensus(analysis.comparisons);
  const tokenCoverage = analysis.rangeSessionCount
    ? (analysis.comparisonSessionCount / analysis.rangeSessionCount) * 100
    : 0;
  const formatCost = (value: number | null): FormattedCost | null => {
    if (value === null) return null;
    const display = (value === 0 || Math.abs(value) >= 0.01 ? money.regular : money.small).format(value);
    return { display, precise: money.precise.format(value) };
  };
  const formatRanges = (ranges: readonly CodexUsageSessionLengthRange[]) =>
    ranges.length ? ranges.map(rangeLabel).join(' · ') : '—';
  const onsetBucket = selectedComparison?.sustainedApiCostIncrease
    ? selectedComparison.buckets.find((bucket) => sameRange(bucket, selectedComparison.sustainedApiCostIncrease!))
    : null;
  const summaryLabels = sourceSummaryLabels(selectedSource, labels);
  return (
    <section className="grid gap-3 border-b pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{labels.title}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedSource}
            onValueChange={(value) => {
              setSelectedSource(value as CodexUsageSessionSource);
              setSelectedComparisonKey('');
            }}
          >
            <SelectTrigger className="h-8 min-w-40" aria-label={labels.sessionSource}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {labels.sources[source]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={selectedComparison ? comparisonKey(selectedComparison) : ''}
            onValueChange={setSelectedComparisonKey}
            disabled={!selectedComparison}
          >
            <SelectTrigger className="h-8 min-w-72" aria-label={labels.modelComparison}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sourceComparisons.map((comparison) => (
                <SelectItem key={comparisonKey(comparison)} value={comparisonKey(comparison)}>
                  {comparison.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <dl className="grid grid-cols-2 divide-x border-y sm:grid-cols-4">
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.rangeCompleteSessions}</dt>
          <dd className="text-lg font-semibold tabular-nums">{numbers.format(analysis.rangeSessionCount)}</dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.tokenComparableSessions}</dt>
          <dd className="text-lg font-semibold tabular-nums">{numbers.format(analysis.comparisonSessionCount)}</dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">
            <TooltipLabel label={labels.overallApiPricedSessions} content={labels.apiNormalizationNote} />
          </dt>
          <dd className="text-lg font-semibold tabular-nums">{numbers.format(overallApiPricedSessions)}</dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.tokenComparisonCoverage}</dt>
          <dd className="text-lg font-semibold tabular-nums">{numbers.format(tokenCoverage)}%</dd>
        </div>
      </dl>
      <OverallSessionLengthSignals
        tokenConsensus={tokenConsensus}
        apiConsensus={apiConsensus}
        sustainedConsensus={sustainedConsensus}
        labels={labels}
        numbers={numbers}
      />
      <dl className="grid grid-cols-2 divide-x border-y md:grid-cols-5">
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.sessions}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {numbers.format(selectedComparison?.sessionCount ?? 0)}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{summaryLabels.totalChatTurns}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {numbers.format(selectedComparison?.totalChatTurns ?? 0)}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{summaryLabels.sessionTurnsPercentiles}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {numbers.format(selectedComparison?.medianSessionTurns ?? 0)} ·{' '}
            {numbers.format(selectedComparison?.percentile90SessionTurns ?? 0)} ·{' '}
            {numbers.format(selectedComparison?.maximumSessionTurns ?? 0)}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.averageContextCompactions}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatAverageContextCompactions(selectedComparison, numbers)}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.apiPricedSessions}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {numbers.format(selectedComparison?.apiPricedSessionCount ?? 0)}/
            {numbers.format(selectedComparison?.sessionCount ?? 0)}
          </dd>
        </div>
      </dl>
      <dl className="grid grid-cols-2 divide-x border-y sm:grid-cols-4">
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.lowestTokenRange}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatRanges(selectedComparison?.lowestMedianTokenRanges ?? [])}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">
            <TooltipLabel label={labels.lowestApiCostRange} content={labels.apiNormalizationNote} />
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatRanges(selectedComparison?.lowestMedianApiCostRanges ?? [])}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.sustainedIncrease}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {selectedComparison?.sustainedApiCostIncrease
              ? `${rangeLabel(selectedComparison.sustainedApiCostIncrease)} · +${numbers.format(
                  selectedComparison.sustainedApiCostIncrease.relativeToLowestPercent,
                )}%`
              : '—'}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.onsetContextRange}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {onsetBucket ? contextRange(onsetBucket, tokens) : '—'}
          </dd>
        </div>
      </dl>
      {selectedComparison && (
        <SessionLengthBucketTable
          comparison={selectedComparison}
          labels={labels}
          tokens={tokens}
          numbers={numbers}
          formatCost={formatCost}
        />
      )}
    </section>
  );
}
