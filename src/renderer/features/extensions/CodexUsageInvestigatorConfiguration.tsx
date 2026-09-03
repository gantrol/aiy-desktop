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
import { cn } from '@/renderer/lib/utils';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  standalone?: boolean;
  workspaceNavigation?: ReactNode;
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
          {format}
        </Button>
      ))}
    </>
  );
}

function CodexUsageToolbar({
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
          <ScanLineIcon className="size-4 shrink-0" />
          <Heading className="truncate text-base font-semibold">{labels.title}</Heading>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
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
        {history.length > 0 && (
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
          <CodexUsageExportButtons available={Boolean(investigationId)} exporting={exporting} onExport={onExport} />
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

export function CodexUsageInvestigatorConfiguration({
  active,
  extension,
  standalone = false,
  workspaceNavigation,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexUsageInvestigator;
  const [range, setRange] = useState<CodexUsageRange>('TODAY');
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
        className={cn('bg-background', standalone ? 'flex size-full min-h-0' : 'grid gap-4')}
      >
        {standalone && (
          <CodexUsageHistoryRail
            history={history}
            locale={locale}
            labels={l}
            selectedId={investigation?.investigationId ?? null}
            task={task}
            workspaceNavigation={workspaceNavigation}
            onSelect={selectHistory}
          />
        )}
        <div
          className={cn(
            '@container/codex-usage grid min-w-0 content-start gap-4',
            standalone && 'min-h-0 flex-1 overflow-y-auto p-5',
          )}
        >
          <CodexUsageToolbar
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
            authorized={authorized}
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
              setHistory(result.state.history);
              clearInvestigation();
            }}
          />

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
            <div className="grid min-h-24 place-items-center text-sm text-muted-foreground">
              {task && ['PAUSED', 'INTERRUPTED'].includes(task.status) ? l.paused : l.empty}
            </div>
          )}
          {investigation && (
            <CodexUsageInvestigationResults
              investigation={investigation}
              labels={l}
              numberLocale={numberLocale}
              displayTimeZone={displayTimeZone}
            />
          )}
          {error && (
            <div role="alert" className="border-l-2 border-destructive/30 py-1 pl-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
