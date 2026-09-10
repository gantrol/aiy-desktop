import { memo, type ReactNode, useMemo } from 'react';
import {
  ActivityIcon,
  CircleDollarSignIcon,
  CoinsIcon,
  GaugeIcon,
  InfoIcon,
  MessageSquareIcon,
  TablePropertiesIcon,
  TargetIcon,
  TimerIcon,
  ZapIcon,
} from 'lucide-react';
import type {
  CodexUsageDailyBreakdown,
  CodexUsageInvestigation,
  CodexUsageQuotaWindow,
  CodexUsageServiceTier,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { CodexQuotaYieldResults } from '@/renderer/features/extensions/CodexQuotaYieldResults';
import { CodexModelComparisonResults } from '@/renderer/features/extensions/CodexModelComparisonResults';
import { CodexUsageSessionLengthResults } from '@/renderer/features/extensions/CodexUsageDetailedStatistics';
import { CodexUsagePulseMetric as PulseMetric } from '@/renderer/features/extensions/CodexUsagePulseMetric';
import { CodexUsageServiceTierLabel } from '@/renderer/features/extensions/CodexUsageServiceTierLabel';
import { CodexUsageTokenMetric } from '@/renderer/features/extensions/CodexUsageTokenMetric';
import { CodexUsageTurnSpeedResults } from '@/renderer/features/extensions/CodexUsageTurnSpeedResults';
import type { useI18n } from '@/renderer/i18n/useI18n';

type UsageLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator'];

interface TokenBucket {
  key: string;
  label: string;
  total: number;
  cached: number;
  uncached: number;
  output: number;
}

interface Formatters {
  tokens: Intl.NumberFormat;
  numbers: Intl.NumberFormat;
  money: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
}

function ReportTabTrigger({ value, label, icon }: { value: string; label: string; icon: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <TabsTrigger
            value={value}
            className="gap-1.5 px-2 data-[state=active]:bg-selected data-[state=active]:text-selected-foreground @lg/codex-usage:px-3"
            aria-label={label}
          >
            {icon}
            <span className="hidden @lg/codex-usage:inline">{label}</span>
          </TabsTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const MAX_CHART_BUCKETS = 48;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function serviceTierLabel(serviceTier: CodexUsageServiceTier, labels: UsageLabels) {
  return labels.quotaYield.modes[serviceTier];
}

function observedCreditsPerQuotaPercent(analysis: CodexUsageInvestigation['quotaYield']) {
  if (!analysis) return null;
  const observed = analysis.estimates.reduce(
    (result, estimate) => {
      if (estimate.codexCredits === null || estimate.quotaPercentObserved <= 0) return result;
      result.credits += estimate.codexCredits;
      result.quotaPercent += estimate.quotaPercentObserved;
      return result;
    },
    { credits: 0, quotaPercent: 0 },
  );
  if (observed.credits <= 0 || observed.quotaPercent <= 0) return null;
  const creditsPerQuotaPercent = observed.credits / observed.quotaPercent;
  return Number.isFinite(creditsPerQuotaPercent) && creditsPerQuotaPercent > 0 ? creditsPerQuotaPercent : null;
}

function estimatedCreditsPerQuotaPercent(investigation: CodexUsageInvestigation) {
  const observed = observedCreditsPerQuotaPercent(investigation.quotaYield);
  if (observed !== null) return observed;
  if (!investigation.quotaYield || investigation.totals.codexCredits === null) return null;
  if (investigation.totals.codexCredits <= 0 || investigation.totals.creditPricedTokens <= 0) return null;
  const observedTotals = investigation.quotaYield.estimates.reduce(
    (result, estimate) => {
      if (estimate.quotaPercentObserved <= 0 || estimate.totalTokens <= 0) return result;
      result.quotaPercent += estimate.quotaPercentObserved;
      result.tokens += estimate.totalTokens;
      return result;
    },
    { quotaPercent: 0, tokens: 0 },
  );
  if (observedTotals.quotaPercent <= 0 || observedTotals.tokens <= 0) return null;
  const estimatedObservedCredits =
    (investigation.totals.codexCredits * observedTotals.tokens) / investigation.totals.creditPricedTokens;
  const estimate = estimatedObservedCredits / observedTotals.quotaPercent;
  return Number.isFinite(estimate) && estimate > 0 ? estimate : null;
}

function roundedQuotaPercent(value: number) {
  if (value <= 0) return 0;
  if (value >= 1) return Math.round(value);
  return Math.max(0.1, Math.round(value * 10) / 10);
}

function formatQuotaSavings(
  creditSavings: number | null,
  creditsPerQuotaPercent: number | null,
  formatter: Intl.NumberFormat,
  creditUnit: string,
  weeklyQuotaUnit: string,
) {
  if (creditSavings === null) return '—';
  if (creditsPerQuotaPercent !== null) {
    const quotaPercent = roundedQuotaPercent(creditSavings / creditsPerQuotaPercent);
    return `≈${formatter.format(quotaPercent)}% ${weeklyQuotaUnit}`;
  }
  return `${formatter.format(creditSavings)} ${creditUnit}`;
}

function buildTokenBuckets(days: CodexUsageDailyBreakdown[], numberLocale: string): TokenBucket[] {
  const sorted = [...days].sort((left, right) => left.date.localeCompare(right.date));
  if (!sorted.length) return [];
  const groupSize = Math.max(1, Math.ceil(sorted.length / MAX_CHART_BUCKETS));
  const date = new Intl.DateTimeFormat(numberLocale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const buckets: TokenBucket[] = [];
  for (let index = 0; index < sorted.length; index += groupSize) {
    const group = sorted.slice(index, index + groupSize);
    const first = group[0]!;
    const last = group.at(-1)!;
    const label =
      first.date === last.date
        ? date.format(new Date(`${first.date}T00:00:00.000Z`))
        : `${date.format(new Date(`${first.date}T00:00:00.000Z`))}–${date.format(new Date(`${last.date}T00:00:00.000Z`))}`;
    const totals = group.reduce(
      (result, day) => {
        result.total += day.totalTokens;
        result.cached += day.cachedInputTokens;
        result.uncached += Math.max(0, day.inputTokens - day.cachedInputTokens);
        result.output += day.outputTokens;
        return result;
      },
      { total: 0, cached: 0, uncached: 0, output: 0 },
    );
    buckets.push({ key: `${first.date}:${last.date}`, label, ...totals });
  }
  return buckets;
}

function QuotaWindow({
  label,
  window,
  formatReset,
}: {
  label: string;
  window: CodexUsageQuotaWindow;
  formatReset(epoch: number | null): string;
}) {
  return (
    <div className="grid gap-1.5 py-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {window.usedPercent.toFixed(window.usedPercent < 10 ? 1 : 0)}% · {formatReset(window.resetsAt)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-surface-sunken">
        <div
          className="h-full bg-foreground/65 transition-[width] duration-normal"
          style={{ width: `${clampPercent(window.usedPercent)}%` }}
        />
      </div>
    </div>
  );
}

function TokenTrendChart({
  days,
  labels,
  numberLocale,
  tokens,
}: {
  days: CodexUsageDailyBreakdown[];
  labels: UsageLabels;
  numberLocale: string;
  tokens: Intl.NumberFormat;
}) {
  const buckets = useMemo(() => buildTokenBuckets(days, numberLocale), [days, numberLocale]);
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.total));
  if (!buckets.length) return null;
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold">{labels.chart.title}</span>
        <span className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1">
            <i aria-hidden className="size-2 bg-foreground/25" />
            {labels.chart.cached}
          </span>
          <span className="flex items-center gap-1">
            <i aria-hidden className="size-2 bg-foreground/55" />
            {labels.chart.uncached}
          </span>
          <span className="flex items-center gap-1">
            <i aria-hidden className="size-2 bg-foreground" />
            {labels.chart.output}
          </span>
        </span>
      </div>
      <div
        className="grid h-40 items-end gap-px border-b py-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(7, buckets.length)}, minmax(0, 1fr))` }}
        role="img"
        aria-label={labels.chart.title}
      >
        {buckets.map((bucket) => {
          const known = Math.max(1, bucket.cached + bucket.uncached + bucket.output);
          const height = Math.max(2, (bucket.total / maximum) * 100);
          return (
            <Tooltip key={bucket.key}>
              <TooltipTrigger asChild>
                <div className="flex h-full min-w-px items-end" tabIndex={0}>
                  <div className="flex w-full flex-col-reverse" style={{ height: `${height}%` }}>
                    {bucket.cached > 0 && (
                      <span className="basis-0 bg-foreground/25" style={{ flexGrow: bucket.cached / known }} />
                    )}
                    {bucket.uncached > 0 && (
                      <span className="basis-0 bg-foreground/55" style={{ flexGrow: bucket.uncached / known }} />
                    )}
                    {bucket.output > 0 && (
                      <span className="basis-0 bg-foreground" style={{ flexGrow: bucket.output / known }} />
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {bucket.label} · {tokens.format(bucket.total)} {labels.chart.total}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{buckets[0]?.label}</span>
        {buckets.length > 1 && <span>{buckets.at(-1)?.label}</span>}
      </div>
    </section>
  );
}

function WorkPulse({
  investigation,
  labels,
  formatters,
  formatSavings,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  formatters: Formatters;
  formatSavings(value: number | null): string;
}) {
  const cacheRate = investigation.totals.inputTokens
    ? (investigation.totals.cachedInputTokens / investigation.totals.inputTokens) * 100
    : 0;
  const apiCoverage = investigation.totals.totalTokens
    ? (investigation.totals.apiPricedTokens / investigation.totals.totalTokens) * 100
    : 100;
  const activeDays = investigation.days.filter((day) => day.totalTokens > 0).length;
  return (
    <dl className="grid grid-cols-2 gap-px bg-border @2xl/codex-usage:grid-cols-3 @5xl/codex-usage:grid-cols-6">
      <PulseMetric
        icon={<CircleDollarSignIcon />}
        label={labels.metrics.apiEquivalent}
        value={
          investigation.totals.apiEquivalentUsd === null
            ? '—'
            : formatters.money.format(investigation.totals.apiEquivalentUsd)
        }
        detail={`${labels.metrics.coverage} ${apiCoverage.toFixed(1)}%`}
      />
      <PulseMetric
        icon={<CoinsIcon />}
        label={labels.metrics.cacheSavings}
        value={formatSavings(investigation.totals.codexCreditCacheSavings)}
        detail={`${labels.metrics.cachedInput} ${formatters.tokens.format(investigation.totals.cachedInputTokens)}`}
      />
      <CodexUsageTokenMetric
        investigation={investigation}
        labels={labels}
        tokens={formatters.tokens}
        numbers={formatters.numbers}
        date={formatters.date}
      />
      <PulseMetric
        icon={<ActivityIcon />}
        label={labels.overview.completedTurns}
        value={investigation.turnSpeed ? formatters.numbers.format(investigation.turnSpeed.completedTurnCount) : '—'}
      />
      <PulseMetric
        icon={<GaugeIcon />}
        label={labels.overview.cacheRate}
        value={`${formatters.numbers.format(cacheRate)}%`}
      />
      <PulseMetric
        icon={<TimerIcon />}
        label={labels.overview.activeDays}
        value={formatters.numbers.format(activeDays)}
      />
    </dl>
  );
}

function leadingModelName(models: CodexUsageInvestigation['models']) {
  const totals = new Map<string, number>();
  for (const model of models) totals.set(model.model, (totals.get(model.model) ?? 0) + model.totalTokens);
  return [...totals].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function OverviewHighlights({
  investigation,
  labels,
  formatters,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  formatters: Formatters;
}) {
  const leadingModel = leadingModelName(investigation.models);
  const fastTokens = investigation.models
    .filter((model) => model.serviceTier === 'FAST')
    .reduce((total, model) => total + model.totalTokens, 0);
  const fastShare = investigation.totals.totalTokens ? (fastTokens / investigation.totals.totalTokens) * 100 : 0;
  return (
    <section className="grid gap-4 @5xl/codex-usage:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.75fr)] @5xl/codex-usage:gap-0">
      <div className="min-w-0 p-3 @xl/codex-usage:p-4 @5xl/codex-usage:border-r">
        <TokenTrendChart
          days={investigation.days}
          labels={labels}
          numberLocale={formatters.numbers.resolvedOptions().locale}
          tokens={formatters.tokens}
        />
      </div>
      <dl className="grid grid-cols-2 gap-px bg-border @5xl/codex-usage:block @5xl/codex-usage:divide-y @5xl/codex-usage:bg-transparent">
        <div className="grid gap-1 bg-background px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.overview.leadingModel}</dt>
          <dd className="truncate font-mono text-xs font-semibold @xl/codex-usage:text-sm">{leadingModel ?? '—'}</dd>
        </div>
        <div className="grid gap-1 bg-background px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.overview.fastShare}</dt>
          <dd className="text-base font-semibold tabular-nums @xl/codex-usage:text-lg">
            {formatters.numbers.format(fastShare)}%
          </dd>
        </div>
        <div className="grid gap-1 bg-background px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.overview.sessions}</dt>
          <dd className="text-base font-semibold tabular-nums @xl/codex-usage:text-lg">
            {formatters.numbers.format(investigation.sessionCount)}
          </dd>
        </div>
        <div className="grid gap-1 bg-background px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.overview.requests}</dt>
          <dd className="text-base font-semibold tabular-nums @xl/codex-usage:text-lg">
            {formatters.numbers.format(investigation.requestCount)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function EconomicsSummary({
  investigation,
  labels,
  formatters,
  formatSavings,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  formatters: Formatters;
  formatSavings(value: number | null): string;
}) {
  const apiCoverage = investigation.totals.totalTokens
    ? (investigation.totals.apiPricedTokens / investigation.totals.totalTokens) * 100
    : 100;
  const creditCoverage = investigation.totals.totalTokens
    ? (investigation.totals.creditPricedTokens / investigation.totals.totalTokens) * 100
    : 100;
  return (
    <dl className="grid grid-cols-2 gap-px bg-border @4xl/codex-usage:grid-cols-4 [&>*]:bg-background">
      <div className="grid gap-1 px-4 py-3">
        <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleDollarSignIcon className="size-3.5" />
          {labels.metrics.apiEquivalent}
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="size-3 cursor-help" />
            </TooltipTrigger>
            <TooltipContent>{labels.apiEquivalentNote}</TooltipContent>
          </Tooltip>
        </dt>
        <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
          {investigation.totals.apiEquivalentUsd === null
            ? '—'
            : formatters.money.format(investigation.totals.apiEquivalentUsd)}
        </dd>
        <dd className="hidden text-[11px] text-muted-foreground @xl/codex-usage:block">
          {labels.metrics.coverage} {apiCoverage.toFixed(1)}%
        </dd>
      </div>
      <div className="grid gap-1 px-4 py-3">
        <dt className="text-xs text-muted-foreground">{labels.metrics.cacheSavings}</dt>
        <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
          {formatSavings(investigation.totals.codexCreditCacheSavings)}
        </dd>
        <dd className="hidden text-[11px] text-muted-foreground @xl/codex-usage:block">
          {labels.metrics.cachedInput} {formatters.tokens.format(investigation.totals.cachedInputTokens)}
        </dd>
      </div>
      <div className="grid gap-1 px-4 py-3">
        <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CoinsIcon className="size-3.5" />
          {labels.metrics.creditEquivalent}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label={labels.metrics.creditEquivalent} className="inline-flex">
                <InfoIcon className="size-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{labels.modelComparison.creditQuota}</TooltipContent>
          </Tooltip>
        </dt>
        <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
          {investigation.totals.codexCredits === null
            ? '—'
            : formatters.numbers.format(investigation.totals.codexCredits)}
        </dd>
        <dd className="hidden text-[11px] text-muted-foreground @xl/codex-usage:block">
          {labels.metrics.coverage} {creditCoverage.toFixed(1)}%
        </dd>
      </div>
      <div className="grid gap-1 px-4 py-3">
        <dt className="text-xs text-muted-foreground">{labels.metrics.totalTokens}</dt>
        <dd className="text-lg font-semibold tabular-nums @xl/codex-usage:text-xl">
          {formatters.tokens.format(investigation.totals.totalTokens)}
        </dd>
        <dd className="hidden text-[11px] text-muted-foreground @xl/codex-usage:block">
          {investigation.requestCount} {labels.metrics.requests} · {investigation.sessionCount}{' '}
          {labels.metrics.sessions}
        </dd>
      </div>
    </dl>
  );
}

function LiveQuota({
  investigation,
  labels,
  date,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  date: Intl.DateTimeFormat;
}) {
  const formatReset = (epoch: number | null) =>
    epoch === null ? labels.quota.noReset : date.format(new Date(epoch * 1_000));
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <GaugeIcon className="size-4" />
        {labels.quota.title}
        <Badge variant={investigation.quotaState === 'LIVE' ? 'default' : 'secondary'}>
          {labels.quota.states[investigation.quotaState]}
        </Badge>
        {investigation.quota?.planType && <Badge variant="outline">{investigation.quota.planType}</Badge>}
        {investigation.quota?.credits && (
          <Badge variant="outline">
            {labels.quota.credits}{' '}
            {investigation.quota.credits.unlimited ? '∞' : (investigation.quota.credits.balance ?? '0')}
          </Badge>
        )}
      </div>
      {investigation.quota?.limits.map((limit, index) => (
        <div key={limit.limitId ?? `${limit.limitName ?? 'limit'}:${index}`} className="grid gap-0 border-t pt-1">
          <div className="pt-2 text-xs font-medium">
            {limit.limitName ?? limit.planType ?? limit.limitId ?? labels.quota.defaultLimit}
          </div>
          {limit.primary && (
            <QuotaWindow label={labels.quota.primary} window={limit.primary} formatReset={formatReset} />
          )}
          {limit.secondary && (
            <QuotaWindow label={labels.quota.secondary} window={limit.secondary} formatReset={formatReset} />
          )}
        </div>
      ))}
      {investigation.quota?.individualLimit && (
        <div className="flex items-center justify-between border-t pt-2 text-xs">
          <span>{labels.quota.individual}</span>
          <span className="tabular-nums text-muted-foreground">
            {investigation.quota.individualLimit.used}/{investigation.quota.individualLimit.limit} ·{' '}
            {formatReset(investigation.quota.individualLimit.resetsAt)}
          </span>
        </div>
      )}
    </section>
  );
}

function ModelUsageTable({
  investigation,
  labels,
  formatters,
  formatSavings,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  formatters: Formatters;
  formatSavings(value: number | null): string;
}) {
  return (
    <div className="max-h-[30rem] overflow-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.table.model}</TableHead>
            <TableHead>{labels.quotaYield.tier}</TableHead>
            <TableHead numeric>{labels.table.requests}</TableHead>
            <TableHead numeric>{labels.table.tokens}</TableHead>
            <TableHead numeric>{labels.table.apiEquivalent}</TableHead>
            <TableHead numeric>{labels.table.cacheSavings}</TableHead>
            <TableHead numeric>{labels.table.credits}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {investigation.models.map((model) => (
            <TableRow key={`${model.model}:${model.serviceTier}`}>
              <TableCell className="max-w-52 truncate font-mono text-xs">{model.model}</TableCell>
              <TableCell>
                <CodexUsageServiceTierLabel
                  label={serviceTierLabel(model.serviceTier, labels)}
                  inferred={model.inferredServiceTierTokens > 0}
                  inferenceHint={labels.quotaYield.inferredMode}
                />
              </TableCell>
              <TableCell numeric>{model.requestCount}</TableCell>
              <TableCell numeric>{formatters.tokens.format(model.totalTokens)}</TableCell>
              <TableCell numeric>
                {model.apiEquivalentUsd === null ? '—' : formatters.money.format(model.apiEquivalentUsd)}
              </TableCell>
              <TableCell numeric>{formatSavings(model.codexCreditCacheSavings)}</TableCell>
              <TableCell numeric>
                {model.codexCredits === null ? '—' : formatters.numbers.format(model.codexCredits)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyReport({ children }: { children: string }) {
  return <div className="grid min-h-28 place-items-center text-sm text-muted-foreground">{children}</div>;
}

export const CodexUsageInvestigationResults = memo(function CodexUsageInvestigationResults({
  investigation,
  labels,
  numberLocale,
  displayTimeZone,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  numberLocale: string;
  displayTimeZone: string;
}) {
  const formatters = useMemo<Formatters>(
    () => ({
      tokens: new Intl.NumberFormat(numberLocale, { notation: 'compact', maximumFractionDigits: 2 }),
      numbers: new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }),
      money: new Intl.NumberFormat(numberLocale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
      date: new Intl.DateTimeFormat(numberLocale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: displayTimeZone,
      }),
    }),
    [displayTimeZone, numberLocale],
  );
  const creditsPerQuotaPercent = estimatedCreditsPerQuotaPercent(investigation);
  const formatSavings = (value: number | null) =>
    formatQuotaSavings(
      value,
      creditsPerQuotaPercent,
      formatters.numbers,
      labels.table.credits,
      labels.quotaYield.weeklyQuota,
    );
  return (
    <Tabs defaultValue="overview" className="block min-w-0">
      <div className="overflow-x-auto border-b">
        <TabsList className="h-10 min-w-full justify-between border-0 @lg/codex-usage:min-w-max @lg/codex-usage:justify-start">
          <ReportTabTrigger
            value="overview"
            label={labels.views.overview}
            icon={<ActivityIcon className="size-3.5" />}
          />
          <ReportTabTrigger value="speed" label={labels.views.speed} icon={<ZapIcon className="size-3.5" />} />
          <ReportTabTrigger
            value="sessions"
            label={labels.views.sessions}
            icon={<MessageSquareIcon className="size-3.5" />}
          />
          <ReportTabTrigger value="quota" label={labels.views.quota} icon={<TargetIcon className="size-3.5" />} />
          <ReportTabTrigger
            value="models"
            label={labels.views.models}
            icon={<TablePropertiesIcon className="size-3.5" />}
          />
        </TabsList>
      </div>

      <TabsContent value="overview" className="grid gap-3 pt-3 @xl/codex-usage:gap-4 @xl/codex-usage:pt-4">
        <WorkPulse
          investigation={investigation}
          labels={labels}
          formatters={formatters}
          formatSavings={formatSavings}
        />
        <OverviewHighlights investigation={investigation} labels={labels} formatters={formatters} />
      </TabsContent>

      <TabsContent value="speed" className="grid gap-3 pt-3 @xl/codex-usage:gap-4 @xl/codex-usage:pt-4">
        {investigation.turnSpeed ? (
          <CodexUsageTurnSpeedResults
            analysis={investigation.turnSpeed}
            labels={labels.turnSpeed}
            numbers={formatters.numbers}
          />
        ) : (
          <EmptyReport>{labels.views.noSpeedData}</EmptyReport>
        )}
      </TabsContent>

      <TabsContent value="sessions" className="grid gap-3 pt-3 @xl/codex-usage:gap-4 @xl/codex-usage:pt-4">
        {investigation.sessionLength ? (
          <CodexUsageSessionLengthResults
            analysis={investigation.sessionLength}
            labels={labels.detailedStatistics}
            tokens={formatters.tokens}
            numbers={formatters.numbers}
            numberLocale={numberLocale}
          />
        ) : (
          <EmptyReport>{labels.views.detailedRequired}</EmptyReport>
        )}
      </TabsContent>

      <TabsContent value="quota" className="grid gap-3 pt-3 @xl/codex-usage:gap-4 @xl/codex-usage:pt-4">
        {investigation.quotaYield ? (
          <CodexQuotaYieldResults
            analysis={investigation.quotaYield}
            labels={labels}
            tokens={formatters.tokens}
            numbers={formatters.numbers}
            date={formatters.date}
          />
        ) : (
          <EmptyReport>{labels.quotaYield.empty}</EmptyReport>
        )}
        <LiveQuota investigation={investigation} labels={labels} date={formatters.date} />
      </TabsContent>

      <TabsContent value="models" className="grid gap-3 pt-3 @xl/codex-usage:gap-4 @xl/codex-usage:pt-4">
        <CodexModelComparisonResults
          analysis={investigation.modelComparison}
          labels={labels.modelComparison}
          numbers={formatters.numbers}
          tokens={formatters.tokens}
          money={formatters.money}
          date={formatters.date}
        />
        <EconomicsSummary
          investigation={investigation}
          labels={labels}
          formatters={formatters}
          formatSavings={formatSavings}
        />
        <ModelUsageTable
          investigation={investigation}
          labels={labels}
          formatters={formatters}
          formatSavings={formatSavings}
        />
      </TabsContent>

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>{investigation.sourceLabel}</span>
        <span className="hidden @lg/codex-usage:inline">·</span>
        <span className="hidden @lg/codex-usage:inline">
          {investigation.filesScanned} {labels.metrics.scannedFiles} · {investigation.filesCached}{' '}
          {labels.metrics.cachedFiles}
        </span>
        <span className="hidden @lg/codex-usage:inline">·</span>
        <span>{formatters.date.format(new Date(investigation.generatedAt))}</span>
        {investigation.warnings.map((warning) => (
          <Badge key={warning} variant="outline">
            {labels.warnings[warning]}
          </Badge>
        ))}
      </footer>
    </Tabs>
  );
});
