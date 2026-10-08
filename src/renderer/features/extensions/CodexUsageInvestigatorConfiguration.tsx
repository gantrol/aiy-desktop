import { CollectionDetailLayout } from '@/renderer/components/workbench/CollectionDetailLayout';
import { CODEX_USAGE_FACT_BACKUP_FAILED } from '@/shared/contracts/codex-usage';
import { useCodexUsageTaskState } from '@/renderer/features/extensions/useCodexUsageTaskState';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DownloadIcon, HistoryIcon, LoaderCircleIcon, ScanLineIcon } from 'lucide-react';
import type {
  CodexUsageCleanupResult,
  CodexUsageDateRange,
  CodexUsageExportFormat,
  CodexUsageGranularity,
  CodexUsageHistoryItem,
  CodexUsageInvestigation,
  CodexUsageRange,
  CodexUsageTask,
  ExtensionDto,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { CodexUsageCleanupControl } from '@/renderer/features/extensions/CodexUsageCleanupDialog';
import {
  CodexUsageDateRangePicker,
  formatCodexUsageDateRange,
} from '@/renderer/features/extensions/CodexUsageDateRangePicker';
import {
  CodexUsageDetailedStatisticsToggle,
  useCodexUsageDetailedStatisticsPreference,
} from '@/renderer/features/extensions/CodexUsageDetailedStatistics';
import { CodexUsageHistoryRail } from '@/renderer/features/extensions/CodexUsageHistoryRail';
import { CodexUsageInvestigationResults } from '@/renderer/features/extensions/CodexUsageInvestigationResults';
import { CodexUsageScanProgress } from '@/renderer/features/extensions/CodexUsageScanProgress';
import {
  CodexUsageTaskControls,
  type CodexUsageTaskAction,
} from '@/renderer/features/extensions/CodexUsageTaskControls';
import { useCodexUsageInvestigationSelection } from '@/renderer/features/extensions/useCodexUsageInvestigationSelection';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useCodexUsageActions } from '@/renderer/features/extensions/useCodexUsageActions';
import { useCodexUsageHistory } from '@/renderer/features/extensions/useCodexUsageHistory';
import { cn } from '@/renderer/lib/utils';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  standalone?: boolean;
  workspaceNavigation?: ReactNode;
  navigationToggleHost?: HTMLElement | null;
  notify(message: string): void;
}

type UsageLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator'];

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

function CodexUsageExportButtons({
  available,
  exporting,
  onExport,
}: {
  available: boolean;
  exporting: CodexUsageExportFormat | null;
  onExport(format: CodexUsageExportFormat): void;
}) {
  const labels = useI18n().messages.extensions.codexUsageInvestigator.workspace;
  return (
    <>
      {(['CSV', 'JSON'] as const).map((format) => (
        <Button
          key={format}
          type="button"
          variant="outline"
          className="w-full @lg/codex-usage:w-auto"
          disabled={!available || Boolean(exporting)}
          onClick={() => onExport(format)}
        >
          {exporting === format ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <DownloadIcon className="size-4" />
          )}
          {format === 'CSV' ? labels.reportCsv : labels.reportJson}
        </Button>
      ))}
    </>
  );
}

function CodexUsageToolbar({
  navigationAction,
  standalone,
  controlsLocked,
  range,
  dateRange,
  detailedStatistics,
  history,
  investigationId,
  running,
  resumable,
  taskAction,
  authorized,
  exporting,
  labels,
  locale,
  historyDate,
  notify,
  onRangeChange,
  onDetailedStatisticsChange,
  onHistorySelect,
  onScan,
  onPause,
  onResume,
  onExport,
  onError,
  onCleared,
}: {
  navigationAction?: ReactNode;
  standalone: boolean;
  controlsLocked: boolean;
  range: CodexUsageRange;
  dateRange: CodexUsageDateRange | null;
  detailedStatistics: boolean;
  history: readonly CodexUsageHistoryItem[];
  investigationId: string | null;
  running: boolean;
  resumable: boolean;
  taskAction: CodexUsageTaskAction;
  authorized: boolean;
  exporting: CodexUsageExportFormat | null;
  labels: UsageLabels;
  locale: 'en' | 'zh';
  historyDate: Intl.DateTimeFormat;
  notify(message: string): void;
  onRangeChange(range: CodexUsageRange, dateRange: CodexUsageDateRange | null): void;
  onDetailedStatisticsChange(value: boolean): void;
  onHistorySelect(investigationId: string): void;
  onScan(): void;
  onPause(): void;
  onResume(): void;
  onExport(format: CodexUsageExportFormat): void;
  onError(message: string): void;
  onCleared(result: CodexUsageCleanupResult): void;
}) {
  const Heading = standalone ? 'h2' : 'h3';
  return (
    <div className={cn('grid min-w-0 gap-3', standalone && 'border-b pb-4')}>
      {standalone && (
        <div className="flex min-w-0 items-center gap-2">
          {navigationAction}
          <ScanLineIcon className="size-4 shrink-0" />
          <Heading className="truncate text-base font-semibold">{labels.title}</Heading>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{labels.workspace.nextScan}</span>
        <CodexUsageDateRangePicker
          className="w-full @md/codex-usage:w-auto"
          collapseLabel
          disabled={controlsLocked}
          range={range}
          dateRange={dateRange}
          onChange={onRangeChange}
        />
        <CodexUsageDetailedStatisticsToggle
          checked={detailedStatistics}
          disabled={controlsLocked}
          label={labels.detailedStatistics.option}
          onCheckedChange={onDetailedStatisticsChange}
        />
        {!standalone && history.length > 0 && (
          <Select value={investigationId ?? undefined} onValueChange={onHistorySelect}>
            <SelectTrigger
              className={cn(
                'h-8 w-full min-w-0 @2xl/codex-usage:w-56 @4xl/codex-usage:w-72',
                standalone && 'md:hidden',
              )}
              aria-label={labels.history}
            >
              <HistoryIcon className="size-3.5" />
              <SelectValue placeholder={labels.history} />
            </SelectTrigger>
            <SelectContent>
              {history.map((item) => (
                <SelectItem key={item.investigationId} value={item.investigationId}>
                  {item.range === 'CUSTOM' && item.dateRange
                    ? formatCodexUsageDateRange(item.dateRange, locale)
                    : labels.ranges[item.range]}{' '}
                  · {item.yieldEstimateCount} {labels.quotaYield.estimates} · {item.yieldSampleCount}{' '}
                  {labels.quotaYield.samples} · {historyDate.format(new Date(item.generatedAt))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="grid w-full grid-cols-2 gap-2 @xl/codex-usage:ml-auto @xl/codex-usage:flex @xl/codex-usage:w-auto @xl/codex-usage:flex-wrap @xl/codex-usage:justify-end">
          <CodexUsageTaskControls
            running={running}
            resumable={resumable}
            action={taskAction}
            authorized={authorized}
            labels={labels.actions}
            onScan={onScan}
            onPause={onPause}
            onResume={onResume}
          />
          <CodexUsageExportButtons
            available={Boolean(investigationId) && !controlsLocked}
            exporting={exporting}
            onExport={onExport}
          />
          <CodexUsageCleanupControl
            disabled={controlsLocked}
            labels={labels.cleanup}
            notify={notify}
            onError={onError}
            onCleared={onCleared}
          />
        </div>
      </div>
    </div>
  );
}

function useSystemTimeZone(active: boolean) {
  const [systemTimeZone, setSystemTimeZone] = useState(currentSystemTimeZone);
  useEffect(() => {
    if (!active) return;
    const refreshTimeZone = () => setSystemTimeZone(currentSystemTimeZone());
    window.addEventListener('focus', refreshTimeZone);
    return () => window.removeEventListener('focus', refreshTimeZone);
  }, [active]);
  return systemTimeZone;
}

function useCodexUsageFormats(locale: 'en' | 'zh') {
  const numberLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  const numbers = useMemo(() => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }), [numberLocale]);
  const historyDate = useMemo(
    () => new Intl.DateTimeFormat(numberLocale, { dateStyle: 'short', timeStyle: 'short' }),
    [numberLocale],
  );

  return { numberLocale, numbers, historyDate };
}

export function CodexUsageInvestigatorConfiguration({
  active,
  extension,
  standalone = false,
  workspaceNavigation,
  navigationToggleHost,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexUsageInvestigator;
  const [range, setRange] = useState<CodexUsageRange>('TODAY');
  const [dateRange, setDateRange] = useState<CodexUsageDateRange | null>(null);
  const [granularity] = useState<CodexUsageGranularity>('AUTO');
  const { enabled: detailedStatistics, setEnabled: setDetailedStatistics } =
    useCodexUsageDetailedStatisticsPreference();
  const systemTimeZone = useSystemTimeZone(active);
  const [displayTimeZone, setDisplayTimeZone] = useState(currentSystemTimeZone);
  const [investigation, setInvestigation] = useState<CodexUsageInvestigation | null>(null);
  const [task, setTask] = useState<CodexUsageTask | null>(null);
  const [error, setError] = useState('');
  const { history, historyCursor, loadingHistory, loadMore, setHistoryState } = useCodexUsageHistory(setError);
  const authorized = extensionAuthorized(extension);
  const { numberLocale, numbers, historyDate } = useCodexUsageFormats(locale);

  const {
    clearInvestigation,
    loadInvestigation,
    loadInitialInvestigation,
    loadCompletedInvestigation,
    expectCompletedInvestigation,
    cancelExpectedInvestigation,
    selectHistory,
    selectRange,
    loading,
  } = useCodexUsageInvestigationSelection({
    setRange,
    setDateRange,
    setDisplayTimeZone,
    setInvestigation,
    setError,
    quotaReadFailed: l.purity.issues.READ_FAILED,
  });

  useEffect(() => {
    if (investigation && history.length === 0) clearInvestigation();
  }, [clearInvestigation, history, investigation]);

  const { taskAction, setTaskAction, exporting, controlsLocked, scan, pause, resume, exportReport } =
    useCodexUsageActions({
      authorized,
      selectionBusy: loading || loadingHistory,
      task,
      investigation,
      scanInput: { range, dateRange, timeZone: systemTimeZone, granularity, detailedStatistics },
      setTask,
      setError,
      expectCompletedInvestigation,
      cancelExpectedInvestigation,
      notify,
      exportedLabel: l.notices.exported,
    });
  useCodexUsageTaskState({
    active,
    authorized,
    taskFailed: l.taskFailed,
    loadInitialInvestigation,
    loadCompletedInvestigation,
    setTask,
    setHistoryState,
    setTaskAction,
    setError,
  });

  const running = task?.status === 'RUNNING';
  const resumable = Boolean(task && ['PAUSED', 'INTERRUPTED'].includes(task.status));
  const progress = running || resumable ? task?.progress : null;
  const changeQuotaSampling = useCallback(
    (minimumQuotaPercent: number) => {
      if (!investigation || controlsLocked || !authorized || exporting) return;
      setError('');
      void loadInvestigation(investigation.investigationId, minimumQuotaPercent).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    },
    [authorized, controlsLocked, exporting, investigation, loadInvestigation],
  );

  const report = (navigationAction: ReactNode = null) => (
    <div
      className={cn(
        '@container/codex-usage grid min-w-0 content-start gap-4',
        standalone && 'min-h-0 flex-1 overflow-y-auto p-5',
      )}
    >
      <CodexUsageToolbar
        navigationAction={navigationAction}
        standalone={standalone}
        controlsLocked={controlsLocked}
        range={range}
        dateRange={dateRange}
        detailedStatistics={detailedStatistics}
        history={history}
        investigationId={investigation?.investigationId ?? null}
        running={running}
        resumable={resumable}
        taskAction={taskAction}
        authorized={authorized && !loading && !exporting && !loadingHistory}
        exporting={exporting}
        labels={l}
        locale={locale}
        historyDate={historyDate}
        notify={notify}
        onRangeChange={selectRange}
        onDetailedStatisticsChange={setDetailedStatistics}
        onHistorySelect={selectHistory}
        onScan={() => void scan()}
        onPause={() => void pause()}
        onResume={() => void resume()}
        onExport={(format) => void exportReport(format)}
        onError={setError}
        onCleared={(result) => {
          setTask(result.state.task);
          setHistoryState(result.state);
          clearInvestigation();
        }}
      />

      {!standalone && historyCursor && (
        <Button variant="ghost" size="sm" disabled={loadingHistory} onClick={() => void loadMore()}>
          {loadingHistory ? l.workspace.loading : l.workspace.loadMore}
        </Button>
      )}
      {progress && task && (
        <p className="text-xs text-muted-foreground">
          {l.evidence.scope}:{' '}
          {task.fromEpoch === null ? l.evidence.allHistory : historyDate.format(new Date(task.fromEpoch))} –{' '}
          {historyDate.format(new Date(task.toEpoch))} · {task.timeZone}
        </p>
      )}
      {progress && (
        <CodexUsageScanProgress
          progress={progress}
          active={running}
          phaseLabel={running ? `${l.workspace.phaseProgress} · ${l.phases[progress.phase]}` : l.paused}
          backgroundLabel={l.background}
          etaLabel={l.eta}
          elapsedLabel={l.elapsed}
          scannedFilesLabel={l.metrics.scannedFiles}
          cachedFilesLabel={l.metrics.cachedFiles}
          numbers={numbers}
        />
      )}

      {!investigation && !progress && (
        <div className="grid min-h-24 place-items-center text-sm text-muted-foreground">
          {task && ['PAUSED', 'INTERRUPTED'].includes(task.status) ? l.paused : l.empty}
        </div>
      )}
      {investigation && (
        <CodexUsageInvestigationResults
          key={investigation.investigationId}
          investigation={investigation}
          labels={l}
          numberLocale={numberLocale}
          displayTimeZone={displayTimeZone}
          quotaSamplingBusy={loading}
          quotaSamplingDisabled={controlsLocked || !authorized || Boolean(exporting)}
          onQuotaSamplingChange={changeQuotaSampling}
          onRescan={() => void scan(investigation.investigationId)}
        />
      )}
      {error && (
        <div role="alert" className="border-l-2 border-destructive/30 py-1 pl-3 text-sm text-destructive">
          {error.includes(CODEX_USAGE_FACT_BACKUP_FAILED)
            ? l.factBackupFailed
            : error.includes('CODEX_USAGE_BUSY')
              ? l.workspace.busy
              : error.includes('CODEX_USAGE_WORKER_FAILED')
                ? l.workspace.workerFailed
                : error}
        </div>
      )}
    </div>
  );
  return (
    <TooltipProvider>
      <section
        data-codex-usage-investigator-configuration
        className={cn('bg-background', standalone ? 'size-full min-h-0 min-w-0' : 'grid gap-4')}
      >
        {standalone ? (
          <CollectionDetailLayout
            layoutKey="codex-usage"
            collectionLabel={l.history}
            collectionWidth={240}
            minimumDetailWidth={600}
            selectionKey={investigation?.investigationId ?? 'new-report'}
            toggleHost={navigationToggleHost}
            collectionHeader={() => (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.history}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {new Intl.NumberFormat(locale).format(history.length)}
                  {historyCursor ? '+' : ''}
                </span>
              </>
            )}
            collection={({ revealDetail }) => (
              <CodexUsageHistoryRail
                history={history}
                hasMore={Boolean(historyCursor)}
                loading={loadingHistory}
                onLoadMore={() => void loadMore()}
                locale={locale}
                labels={l}
                selectedId={investigation?.investigationId ?? null}
                task={task}
                workspaceNavigation={workspaceNavigation}
                onSelect={(id) => {
                  if (id === investigation?.investigationId) revealDetail();
                  else selectHistory(id);
                }}
              />
            )}
          >
            {({ toggle }) => report(toggle)}
          </CollectionDetailLayout>
        ) : (
          report()
        )}
      </section>
    </TooltipProvider>
  );
}
