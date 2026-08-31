import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleDollarSignIcon,
  CoinsIcon,
  DownloadIcon,
  GaugeIcon,
  HistoryIcon,
  InfoIcon,
  LoaderCircleIcon,
  ScanLineIcon,
} from 'lucide-react';
import type {
  CodexUsageDateRange,
  CodexUsageDailyBreakdown,
  CodexUsageExportFormat,
  CodexUsageGranularity,
  CodexUsageHistoryItem,
  CodexUsageInvestigation,
  CodexUsageQuotaWindow,
  CodexUsageRange,
  CodexUsageServiceTier,
  CodexUsageTask,
  ExtensionDto,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { CodexQuotaYieldResults } from '@/renderer/features/extensions/CodexQuotaYieldResults';
import { CodexUsageCleanupControl } from '@/renderer/features/extensions/CodexUsageCleanupDialog';
import {
  CodexUsageDateRangePicker,
  formatCodexUsageDateRange,
} from '@/renderer/features/extensions/CodexUsageDateRangePicker';
import {
  CodexUsageDetailedStatisticsToggle,
  CodexUsageSessionLengthResults,
  useCodexUsageDetailedStatisticsPreference,
} from '@/renderer/features/extensions/CodexUsageDetailedStatistics';
import { CodexUsageScanProgress } from '@/renderer/features/extensions/CodexUsageScanProgress';
import { CodexUsageServiceTierLabel } from '@/renderer/features/extensions/CodexUsageServiceTierLabel';
import {
  CodexUsageTaskControls,
  type CodexUsageTaskAction,
} from '@/renderer/features/extensions/CodexUsageTaskControls';
import { CodexUsageTurnSpeedResults } from '@/renderer/features/extensions/CodexUsageTurnSpeedResults';
import { useCodexUsageInvestigationSelection } from '@/renderer/features/extensions/useCodexUsageInvestigationSelection';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  standalone?: boolean;
  notify(message: string): void;
}

interface TokenBucket {
  key: string;
  label: string;
  total: number;
  cached: number;
  uncached: number;
  output: number;
}

const MAX_CHART_BUCKETS = 48;

function currentSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function extensionAuthorized(extension: ExtensionDto) {
  return (
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted)
  );
}

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
  // Unknown Standard/Fast rows use the priced rows' average Credits per token as a midpoint estimate.
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

type UsageLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator'];

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
    <section className="grid gap-2 border-b pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold">{labels.chart.title}</span>
        <span className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1">
            <i className="size-2 bg-foreground/25" />
            {labels.chart.cached}
          </span>
          <span className="flex items-center gap-1">
            <i className="size-2 bg-foreground/55" />
            {labels.chart.uncached}
          </span>
          <span className="flex items-center gap-1">
            <i className="size-2 bg-foreground" />
            {labels.chart.output}
          </span>
        </span>
      </div>
      <div className="flex h-36 items-end gap-px border-y py-2" role="img" aria-label={labels.chart.title}>
        {buckets.map((bucket) => {
          const known = Math.max(1, bucket.cached + bucket.uncached + bucket.output);
          const height = Math.max(2, (bucket.total / maximum) * 100);
          return (
            <Tooltip key={bucket.key}>
              <TooltipTrigger asChild>
                <div className="flex h-full min-w-px flex-1 items-end" tabIndex={0}>
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
        <span>{buckets.at(-1)?.label}</span>
      </div>
    </section>
  );
}

const UsageInvestigationResults = memo(function UsageInvestigationResults({
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
  const tokens = useMemo(
    () => new Intl.NumberFormat(numberLocale, { notation: 'compact', maximumFractionDigits: 2 }),
    [numberLocale],
  );
  const numbers = useMemo(() => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }), [numberLocale]);
  const money = useMemo(
    () =>
      new Intl.NumberFormat(numberLocale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
    [numberLocale],
  );
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat(numberLocale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: displayTimeZone,
      }),
    [displayTimeZone, numberLocale],
  );
  const formatMoney = (value: number | null) => (value === null ? '—' : money.format(value));
  const formatCredits = (value: number | null) => (value === null ? '—' : numbers.format(value));
  const creditsPerQuotaPercent = estimatedCreditsPerQuotaPercent(investigation);
  const formatSavings = (value: number | null) =>
    formatQuotaSavings(value, creditsPerQuotaPercent, numbers, labels.table.credits, labels.quotaYield.weeklyQuota);
  const formatReset = (epoch: number | null) =>
    epoch === null ? labels.quota.noReset : date.format(new Date(epoch * 1_000));
  const apiCoverage = investigation.totals.totalTokens
    ? (investigation.totals.apiPricedTokens / investigation.totals.totalTokens) * 100
    : 100;
  const creditCoverage = investigation.totals.totalTokens
    ? (investigation.totals.creditPricedTokens / investigation.totals.totalTokens) * 100
    : 100;
  return (
    <>
      <dl className="grid grid-cols-2 divide-x border-y sm:grid-cols-4">
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
          <dd className="text-xl font-semibold tabular-nums">{formatMoney(investigation.totals.apiEquivalentUsd)}</dd>
          <dd className="text-[11px] text-muted-foreground">
            {labels.metrics.coverage} {apiCoverage.toFixed(1)}%
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.metrics.cacheSavings}</dt>
          <dd className="text-xl font-semibold tabular-nums">
            {formatSavings(investigation.totals.codexCreditCacheSavings)}
          </dd>
          <dd className="text-[11px] text-muted-foreground">
            {labels.metrics.cachedInput} {tokens.format(investigation.totals.cachedInputTokens)}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CoinsIcon className="size-3.5" />
            {labels.metrics.creditEquivalent}
          </dt>
          <dd className="text-xl font-semibold tabular-nums">{formatCredits(investigation.totals.codexCredits)}</dd>
          <dd className="text-[11px] text-muted-foreground">
            {labels.metrics.coverage} {creditCoverage.toFixed(1)}%
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{labels.metrics.totalTokens}</dt>
          <dd className="text-xl font-semibold tabular-nums">{tokens.format(investigation.totals.totalTokens)}</dd>
          <dd className="text-[11px] text-muted-foreground">
            {investigation.requestCount} {labels.metrics.requests} · {investigation.sessionCount}{' '}
            {labels.metrics.sessions}
          </dd>
        </div>
      </dl>

      {investigation.turnSpeed && (
        <CodexUsageTurnSpeedResults analysis={investigation.turnSpeed} labels={labels.turnSpeed} numbers={numbers} />
      )}

      {investigation.sessionLength && (
        <CodexUsageSessionLengthResults
          analysis={investigation.sessionLength}
          labels={labels.detailedStatistics}
          tokens={tokens}
          numbers={numbers}
          numberLocale={numberLocale}
        />
      )}

      {investigation.quotaYield && (
        <CodexQuotaYieldResults
          analysis={investigation.quotaYield}
          labels={labels}
          tokens={tokens}
          numbers={numbers}
          date={date}
        />
      )}

      <TokenTrendChart days={investigation.days} labels={labels} numberLocale={numberLocale} tokens={tokens} />

      <section className="grid gap-2 border-b pb-3">
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

      <section className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{investigation.sourceLabel}</span>
          <span>·</span>
          <span>
            {investigation.filesScanned} {labels.metrics.scannedFiles} · {investigation.filesCached}{' '}
            {labels.metrics.cachedFiles}
          </span>
          <span>·</span>
          <span>{date.format(new Date(investigation.generatedAt))}</span>
          {investigation.warnings.map((warning) => (
            <Badge key={warning} variant="outline">
              {labels.warnings[warning]}
            </Badge>
          ))}
        </div>
        <div className="max-h-72 overflow-auto border-y">
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
                  <TableCell numeric>{tokens.format(model.totalTokens)}</TableCell>
                  <TableCell numeric>{formatMoney(model.apiEquivalentUsd)}</TableCell>
                  <TableCell numeric>{formatSavings(model.codexCreditCacheSavings)}</TableCell>
                  <TableCell numeric>{formatCredits(model.codexCredits)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
});

function CodexUsageExportButtons({
  available,
  exporting,
  onExport,
}: {
  available: boolean;
  exporting: CodexUsageExportFormat | null;
  onExport(format: CodexUsageExportFormat): void;
}) {
  return (
    <>
      {(['CSV', 'JSON'] as const).map((format) => (
        <Button
          key={format}
          type="button"
          variant="outline"
          disabled={!available || Boolean(exporting)}
          onClick={() => onExport(format)}
        >
          {exporting === format ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <DownloadIcon className="size-4" />
          )}
          {format}
        </Button>
      ))}
    </>
  );
}

export function CodexUsageInvestigatorConfiguration({ active, extension, standalone = false, notify }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexUsageInvestigator;
  const [range, setRange] = useState<CodexUsageRange>('LAST_30_DAYS');
  const [dateRange, setDateRange] = useState<CodexUsageDateRange | null>(null);
  const [granularity, setGranularity] = useState<CodexUsageGranularity>('AUTO');
  const { enabled: detailedStatistics, setEnabled: setDetailedStatistics } =
    useCodexUsageDetailedStatisticsPreference();
  const [systemTimeZone, setSystemTimeZone] = useState(currentSystemTimeZone);
  const [displayTimeZone, setDisplayTimeZone] = useState(currentSystemTimeZone);
  const [investigation, setInvestigation] = useState<CodexUsageInvestigation | null>(null);
  const [history, setHistory] = useState<CodexUsageHistoryItem[]>([]);
  const [task, setTask] = useState<CodexUsageTask | null>(null);
  const [taskAction, setTaskAction] = useState<CodexUsageTaskAction>(null);
  const [exporting, setExporting] = useState<CodexUsageExportFormat | null>(null);
  const [error, setError] = useState('');
  const authorized = extensionAuthorized(extension);
  const Heading = standalone ? 'h2' : 'h3';
  const numberLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  const numbers = useMemo(() => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }), [numberLocale]);
  const historyDate = useMemo(
    () => new Intl.DateTimeFormat(numberLocale, { dateStyle: 'short', timeStyle: 'short' }),
    [numberLocale],
  );

  const { clearInvestigation, loadInvestigation, selectHistory, selectRange } = useCodexUsageInvestigationSelection({
    history,
    setRange,
    setDateRange,
    setGranularity,
    setDisplayTimeZone,
    setInvestigation,
    setError,
  });

  const refreshState = useCallback(
    async (preferredInvestigationId?: string) => {
      const state = await window.desktopApi.codexUsageState();
      setTask(state.task);
      setHistory(state.history);
      const investigationId = preferredInvestigationId ?? state.history[0]?.investigationId;
      if (investigationId) await loadInvestigation(investigationId);
      else setInvestigation(null);
    },
    [loadInvestigation],
  );

  useEffect(() => {
    if (!active || !authorized) return;
    let disposed = false;
    const applyTask = (nextTask: CodexUsageTask) => {
      if (disposed) return;
      setTask(nextTask);
      setTaskAction((current) => (current === 'PAUSE' && nextTask.status === 'RUNNING' ? current : null));
      if (nextTask.status === 'COMPLETED' && nextTask.investigationId) {
        void refreshState(nextTask.investigationId).catch((reason: unknown) => {
          if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
        });
      }
      if (nextTask.status === 'FAILED') setError(nextTask.errorMessage ?? l.taskFailed);
    };
    const unsubscribe = window.desktopApi.onCodexUsageTaskChanged(applyTask);
    void refreshState().catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [active, authorized, l.taskFailed, refreshState]);

  useEffect(() => {
    if (!active) return;
    const refreshTimeZone = () => setSystemTimeZone(currentSystemTimeZone());
    window.addEventListener('focus', refreshTimeZone);
    return () => window.removeEventListener('focus', refreshTimeZone);
  }, [active]);

  const running = task?.status === 'RUNNING';
  const resumable = Boolean(task && ['PAUSED', 'INTERRUPTED'].includes(task.status));
  const progress = running || resumable ? task?.progress : null;
  const controlsLocked = running || taskAction !== null;

  async function scan() {
    if (!authorized || controlsLocked) return;
    setTaskAction('SCAN');
    setError('');
    try {
      setTask(
        await window.desktopApi.codexUsageScan({
          range,
          dateRange,
          timeZone: systemTimeZone,
          granularity,
          detailedStatistics,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTaskAction(null);
    }
  }

  async function pause() {
    if (taskAction !== null) return;
    setTaskAction('PAUSE');
    setError('');
    try {
      await window.desktopApi.codexUsagePause();
    } catch (reason) {
      setTaskAction(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function resume() {
    if (!task || !['PAUSED', 'INTERRUPTED'].includes(task.status) || taskAction !== null) return;
    setTaskAction('RESUME');
    setError('');
    try {
      setTask(await window.desktopApi.codexUsageResume({ taskId: task.taskId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTaskAction(null);
    }
  }

  async function exportReport(format: CodexUsageExportFormat) {
    if (!investigation || exporting) return;
    setExporting(format);
    setError('');
    try {
      const result = await window.desktopApi.codexUsageExport({
        investigationId: investigation.investigationId,
        format,
      });
      if (result.status === 'exported') notify(`${l.notices.exported}: ${result.fileName}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(null);
    }
  }

  return (
    <TooltipProvider>
      <section
        data-codex-usage-investigator-configuration
        className={cn(
          'grid gap-4 bg-background',
          standalone ? 'size-full min-h-0 overflow-y-auto p-5' : 'border-t pt-5',
        )}
      >
        <div className={cn('flex flex-wrap items-center gap-3', standalone && 'border-b pb-4')}>
          <div className="flex items-center gap-2">
            <ScanLineIcon className="size-4" />
            <Heading className={cn('font-semibold', standalone ? 'text-base' : 'text-sm')}>{l.title}</Heading>
          </div>
          <CodexUsageDateRangePicker
            disabled={controlsLocked}
            range={range}
            dateRange={dateRange}
            onChange={selectRange}
          />
          <CodexUsageDetailedStatisticsToggle
            checked={detailedStatistics}
            disabled={controlsLocked}
            label={l.detailedStatistics.option}
            onCheckedChange={setDetailedStatistics}
          />
          {history.length > 0 && (
            <Select value={investigation?.investigationId} onValueChange={selectHistory}>
              <SelectTrigger className="h-8 w-72" aria-label={l.history}>
                <HistoryIcon className="size-3.5" />
                <SelectValue placeholder={l.history} />
              </SelectTrigger>
              <SelectContent>
                {history.map((item) => (
                  <SelectItem key={item.investigationId} value={item.investigationId}>
                    {item.range === 'CUSTOM' && item.dateRange
                      ? formatCodexUsageDateRange(item.dateRange, locale)
                      : l.ranges[item.range]}{' '}
                    · {item.yieldEstimateCount} {l.quotaYield.estimates} · {item.yieldSampleCount}{' '}
                    {l.quotaYield.samples} · {historyDate.format(new Date(item.generatedAt))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-2">
            <CodexUsageTaskControls
              running={running}
              resumable={resumable}
              action={taskAction}
              authorized={authorized}
              labels={l.actions}
              onScan={() => void scan()}
              onPause={() => void pause()}
              onResume={() => void resume()}
            />
            <CodexUsageExportButtons
              available={Boolean(investigation)}
              exporting={exporting}
              onExport={(format) => void exportReport(format)}
            />
            <CodexUsageCleanupControl
              disabled={controlsLocked}
              labels={l.cleanup}
              notify={notify}
              onError={setError}
              onCleared={(result) => {
                setTask(result.state.task);
                setHistory(result.state.history);
                clearInvestigation();
              }}
            />
          </div>
        </div>

        {progress && (
          <CodexUsageScanProgress
            progress={progress}
            active={running}
            phaseLabel={running ? l.phases[progress.phase] : l.paused}
            backgroundLabel={l.background}
            etaLabel={l.eta}
            elapsedLabel={l.elapsed}
            scannedFilesLabel={l.metrics.scannedFiles}
            cachedFilesLabel={l.metrics.cachedFiles}
            numbers={numbers}
          />
        )}

        {!investigation && !progress && (
          <div className="grid min-h-24 place-items-center border-y text-sm text-muted-foreground">
            {task && ['PAUSED', 'INTERRUPTED'].includes(task.status) ? l.paused : l.empty}
          </div>
        )}
        {investigation && (
          <UsageInvestigationResults
            investigation={investigation}
            labels={l}
            numberLocale={numberLocale}
            displayTimeZone={displayTimeZone}
          />
        )}
        {error && (
          <div role="alert" className="border-y border-destructive/30 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
