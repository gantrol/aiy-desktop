import { useEffect, useMemo, useState } from 'react';
import { ActivityIcon, CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import type {
  AssistantRunDto,
  CodexHealth,
  DirectionExperimentDirectorTaskDto,
  ImageGenerationRouteDto,
  GenerationTaskDto,
  ModelWorkerStatusDto,
  PromptSeriesDto,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { generationElapsed, generationPhaseLabel } from '@/renderer/components/generation/task-presentation';
import { groupGenerationTasks, leadGenerationTask } from '@/renderer/components/generation/generationTaskGroups';
import { GenerationErrorNotice } from '@/renderer/components/generation/GenerationErrorNotice';
import {
  loadDismissedGenerationRunIds,
  saveDismissedGenerationRunIds,
} from '@/renderer/components/generation/dismissedGenerationErrors';
import { DirectionExperimentTaskCenterItem } from '@/renderer/components/app/DirectionExperimentTaskCenterItem';
import { GenerationIssueActions } from '@/renderer/components/app/GenerationIssueActions';

interface Props {
  workerStatus: ModelWorkerStatusDto | null;
  codexHealth: CodexHealth | null;
  tasks: GenerationTaskDto[];
  routes: ImageGenerationRouteDto[];
  assistantRuns: AssistantRunDto[];
  agentTasks: DirectionExperimentDirectorTaskDto[];
  series: PromptSeriesDto[];
  onCancel(runId: string): Promise<void>;
  onRetry(runId: string): Promise<void>;
  onReEdit(runId: string): void;
  notify(message: string): void;
}

export function GenerationStatusPopover({
  workerStatus,
  codexHealth,
  tasks,
  routes,
  assistantRuns,
  agentTasks,
  series,
  onCancel,
  onRetry,
  onReEdit,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.app.generationStatus;
  const taskLabels = messages.creator.generationTasks;
  const [dismissedRunIds, setDismissedRunIds] = useState(loadDismissedGenerationRunIds);
  const [open, setOpen] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const titleBySeriesId = useMemo(() => new Map(series.map((item) => [item.id, item.title])), [series]);
  const modelNameByKey = useMemo(() => new Map(routes.map((model) => [model.key, model.name])), [routes]);
  const issues = useMemo(() => {
    const rows = series.flatMap((item) =>
      item.versions.flatMap((version) => version.runs.map((run) => ({ run, seriesId: item.id, title: item.title }))),
    );
    const retried = new Set(rows.flatMap(({ run }) => (run.retryOfRunId ? [run.retryOfRunId] : [])));
    return rows
      .filter(({ run }) => ['FAILED', 'INTERRUPTED'].includes(run.status) && !retried.has(run.id))
      .sort(
        (left, right) =>
          right.run.createdAt.localeCompare(left.run.createdAt) || right.run.id.localeCompare(left.run.id),
      )
      .slice(0, 5);
  }, [series]);
  const activeAssistantRuns = useMemo(() => assistantRuns.filter((run) => run.status === 'RUNNING'), [assistantRuns]);
  const activeDirectorStatuses = new Set([
    'DELEGATED',
    'PREPARING',
    'EXECUTING',
    'WAITING_DECISION',
    'PAUSED',
    'WRAPPING_UP',
  ]);
  const activeDirectorTasks = agentTasks.filter((task) => activeDirectorStatuses.has(task.status));
  const directorIssues = agentTasks.filter((task) => ['PARTIAL_SUCCESS', 'FAILED'].includes(task.status)).slice(0, 3);
  const agentRunIds = new Set(agentTasks.flatMap((task) => task.runIds));
  const standaloneIssues = issues.filter(({ run }) => !agentRunIds.has(run.id) && !dismissedRunIds.has(run.id));
  const coveredRunIds = new Set(activeDirectorTasks.flatMap((task) => task.runIds));
  const visibleGenerationTasks = tasks.filter((task) => !coveredRunIds.has(task.runId));
  const visibleGenerationTaskGroups = groupGenerationTasks(visibleGenerationTasks);
  const coveredActiveRunCount = tasks.length - visibleGenerationTasks.length;
  const generationTaskCount = Math.max(0, (workerStatus?.generationTaskCount ?? tasks.length) - coveredActiveRunCount);
  const codexTaskCount = workerStatus?.codexTaskCount ?? activeAssistantRuns.length;
  const activeCount = generationTaskCount + codexTaskCount + activeDirectorTasks.length;
  const visibleAssistantRuns = activeAssistantRuns.slice(0, codexTaskCount);
  const otherCodexTaskCount = Math.max(0, codexTaskCount - visibleAssistantRuns.length);
  const reconnecting = !workerStatus || workerStatus.state === 'RECONNECTING';
  const attentionCount = standaloneIssues.length + directorIssues.length;

  useEffect(() => saveDismissedGenerationRunIds(dismissedRunIds), [dismissedRunIds]);

  useEffect(() => {
    if (!tasks.some((task) => task.status === 'RUNNING')) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [tasks]);

  async function cancelTasks(key: string, runIds: string[]) {
    if (busyRunId) return;
    setBusyRunId(key);
    try {
      await Promise.all(runIds.map((runId) => onCancel(runId)));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRunId(null);
    }
  }

  async function retry(runId: string) {
    if (busyRunId) return;
    setBusyRunId(runId);
    try {
      await onRetry(runId);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRunId(null);
    }
  }

  function dismissRun(runId: string) {
    setDismissedRunIds((current) => new Set(current).add(runId));
  }

  function reEdit(runId: string) {
    onReEdit(runId);
    setOpen(false);
  }

  const statusText = reconnecting
    ? l.reconnecting
    : activeCount > 0
      ? l.active(activeCount)
      : attentionCount > 0
        ? l.attention(attentionCount)
        : l.idle;
  const label = `${l.backgroundTasks} · ${statusText}`;
  const StatusIcon =
    reconnecting || activeCount > 0 ? LoaderCircleIcon : attentionCount > 0 ? CircleAlertIcon : CircleCheckIcon;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-action="background-tasks"
          data-worker-state={reconnecting ? 'RECONNECTING' : 'CONNECTED'}
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
          aria-label={label}
        >
          <StatusIcon
            className={
              reconnecting || activeCount > 0
                ? 'size-3.5 animate-spin'
                : attentionCount > 0
                  ? 'size-3.5 text-destructive'
                  : 'size-3.5 text-success'
            }
          />
          <span>{l.backgroundTasks}</span>
          <span className="text-foreground">{statusText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={4} className="w-96 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium">{l.backgroundTasks}</div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b px-3 py-2 text-xs">
          <span className="text-muted-foreground">{l.service}</span>
          <span className="flex items-center gap-1.5">
            <ActivityIcon className="size-3.5" />
            {reconnecting ? l.reconnecting : l.connected}
          </span>
          <span className="text-muted-foreground">Codex</span>
          <span className={codexHealth?.state === 'unavailable' ? 'text-destructive' : ''}>
            {codexHealth?.state === 'ready'
              ? l.available
              : codexHealth?.state === 'unavailable'
                ? l.unavailable
                : l.checking}
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {!activeCount && !standaloneIssues.length && !directorIssues.length && (
            <div className="px-3 py-3 text-xs text-muted-foreground">{l.idle}</div>
          )}
          {[...activeDirectorTasks, ...directorIssues].map((task) => (
            <DirectionExperimentTaskCenterItem
              key={task.id}
              locale={locale}
              task={task}
              generationTasks={tasks.filter((run) => task.runIds.includes(run.runId))}
            />
          ))}
          {visibleGenerationTaskGroups.map((group) => {
            const task = leadGenerationTask(group);
            const isBatch = Boolean(group.batchId);
            const title = titleBySeriesId.get(task.seriesId) ?? task.runId.slice(-6);
            const modelSummary = group.modelKeys.map((key) => modelNameByKey.get(key) ?? key).join(' + ');
            return (
              <div
                key={group.key}
                data-generation-batch={group.batchId ?? undefined}
                className="flex h-10 items-center gap-2 border-b px-3 text-xs last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate" title={modelSummary ? `${title} · ${modelSummary}` : title}>
                  {title}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {generationPhaseLabel(task, l)}
                  {isBatch
                    ? ` · ${taskLabels.batchModels(group.modelKeys.length)} · ${taskLabels.batchProgress(group.completedCount, group.totalCount)}`
                    : ''}
                  {generationElapsed(task, nowMs) ? ` · ${generationElapsed(task, nowMs)}` : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  disabled={Boolean(busyRunId) || group.tasks.every((item) => item.phase === 'CANCELLING')}
                  title={isBatch ? taskLabels.cancelBatch : l.cancel}
                  aria-label={isBatch ? taskLabels.cancelBatch : l.cancel}
                  onClick={() =>
                    void cancelTasks(
                      group.key,
                      group.tasks.map((item) => item.runId),
                    )
                  }
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            );
          })}
          {visibleAssistantRuns.map((run) => (
            <div key={run.id} className="flex h-10 items-center gap-2 border-b px-3 text-xs last:border-b-0">
              <span className="min-w-0 flex-1 truncate">
                {run.mode === 'directions' ? l.directionsTask : l.optimizeTask}
              </span>
              <span className="shrink-0 text-muted-foreground">{l.generating}</span>
            </div>
          ))}
          {otherCodexTaskCount > 0 && (
            <div className="flex h-10 items-center gap-2 border-b px-3 text-xs last:border-b-0">
              <span className="min-w-0 flex-1 truncate">{l.codexTasks(otherCodexTaskCount)}</span>
              <span className="shrink-0 text-muted-foreground">{l.generating}</span>
            </div>
          )}
          {standaloneIssues.map(({ run, title }) => (
            <div key={run.id} className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{title}</span>
                <GenerationErrorNotice
                  run={run}
                  showIcon={false}
                  className="flex max-w-full"
                  summaryClassName="block truncate"
                />
              </span>
              <GenerationIssueActions
                status={run.status}
                busy={Boolean(busyRunId)}
                reEditLabel={l.reEdit}
                retryLabel={l.retry}
                regenerateLabel={l.regenerate}
                dismissLabel={taskLabels.dismiss}
                onReEdit={() => reEdit(run.id)}
                onRetry={() => void retry(run.id)}
                onDismiss={() => dismissRun(run.id)}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
