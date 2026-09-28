import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ActivityIcon, ChevronDownIcon, CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import type {
  AssistantRunDto,
  BackgroundIssueDto,
  CodexHealth,
  DirectionExperimentDirectorTaskDto,
  ImageGenerationRouteDto,
  GenerationTaskDto,
  ModelWorkerStatusDto,
  PromptSeriesDto,
  VideoDocumentTranscriptBackgroundTask,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { generationElapsed, generationPhaseLabel } from '@/renderer/components/generation/task-presentation';
import {
  groupGenerationTasks,
  leadGenerationTask,
  type GenerationTaskGroup,
} from '@/renderer/components/generation/generationTaskGroups';
import { GenerationErrorNotice } from '@/renderer/components/generation/GenerationErrorNotice';
import { DirectionExperimentTaskCenterItem } from '@/renderer/components/app/DirectionExperimentTaskCenterItem';
import { GenerationIssueActions } from '@/renderer/components/app/GenerationIssueActions';
import { VideoDocumentTranscriptTaskCenterItem } from '@/renderer/components/app/VideoDocumentTranscriptTaskCenterItem';
import { useBackgroundIssues } from '@/renderer/features/background-issues/BackgroundIssueProvider';
import { useArticleDeliveries } from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import { ArticleDeliveryTaskItem } from '@/renderer/features/article-delivery/ArticleDeliveryTaskItem';
import { articleDeliveryActive } from '@/renderer/features/article-delivery/presentation';

interface Props {
  workerStatus: ModelWorkerStatusDto | null;
  codexHealth: CodexHealth | null;
  tasks: GenerationTaskDto[];
  transcriptTasks: VideoDocumentTranscriptBackgroundTask[];
  routes: ImageGenerationRouteDto[];
  assistantRuns: AssistantRunDto[];
  agentTasks: DirectionExperimentDirectorTaskDto[];
  series: PromptSeriesDto[];
  onCancel(runId: string): Promise<void>;
  onTranscriptCancel(operationId: string): Promise<void>;
  onRetry(runId: string): Promise<void>;
  onReEdit(runId: string): void;
  notify(message: string): void;
}

const ACTIVE_DIRECTOR_STATUSES = new Set<DirectionExperimentDirectorTaskDto['status']>([
  'DELEGATED',
  'PREPARING',
  'EXECUTING',
  'WAITING_DECISION',
  'PAUSED',
  'WRAPPING_UP',
]);

function backgroundStatusText(
  labels: { reconnecting: string; active(count: number): string; attention(count: number): string; idle: string },
  reconnecting: boolean,
  activeCount: number,
  attentionCount: number,
) {
  if (reconnecting) return labels.reconnecting;
  if (activeCount > 0) return labels.active(activeCount);
  if (attentionCount > 0) return labels.attention(attentionCount);
  return labels.idle;
}

function generationIssues(
  series: PromptSeriesDto[],
  agentRunIds: ReadonlySet<string>,
  isAcknowledged: (issue: BackgroundIssueDto | null | undefined) => boolean,
) {
  const rows = series.flatMap((item) =>
    item.versions.flatMap((version) => version.runs.map((run) => ({ run, seriesId: item.id, title: item.title }))),
  );
  const retried = new Set(rows.flatMap(({ run }) => (run.retryOfRunId ? [run.retryOfRunId] : [])));
  return rows
    .filter(
      ({ run }) =>
        ['FAILED', 'INTERRUPTED'].includes(run.status) &&
        !retried.has(run.id) &&
        !agentRunIds.has(run.id) &&
        !isAcknowledged(run.backgroundIssue),
    )
    .sort(
      (left, right) => right.run.createdAt.localeCompare(left.run.createdAt) || right.run.id.localeCompare(left.run.id),
    )
    .slice(0, 5);
}

function backgroundTaskIconClassName(reconnecting: boolean, activeCount: number, attentionCount: number) {
  if (reconnecting || activeCount > 0) return 'size-3.5 animate-spin';
  return attentionCount > 0 ? 'size-3.5 text-destructive' : 'size-3.5 text-success';
}

function GenerationTaskRows({
  groups,
  titleBySeriesId,
  modelNameByKey,
  nowMs,
  busy,
  onCancel,
}: {
  groups: GenerationTaskGroup[];
  titleBySeriesId: ReadonlyMap<string, string>;
  modelNameByKey: ReadonlyMap<string, string>;
  nowMs: number;
  busy: boolean;
  onCancel(key: string, runIds: string[]): Promise<void>;
}) {
  const { messages } = useI18n();
  const l = messages.app.generationStatus;
  const taskLabels = messages.creator.generationTasks;
  return groups.map((group) => {
    const task = leadGenerationTask(group);
    const isBatch = Boolean(group.batchId);
    const title = titleBySeriesId.get(task.seriesId) ?? task.runId.slice(-6);
    const modelSummary = group.modelKeys.map((key) => modelNameByKey.get(key) ?? key).join(' + ');
    return (
      <div
        key={group.key}
        data-generation-batch={group.batchId ?? undefined}
        className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
      >
        <span className="min-w-0 flex-1 truncate" title={modelSummary ? `${title} · ${modelSummary}` : title}>
          {title}
        </span>
        <span className="max-w-[65%] text-right text-muted-foreground">
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
          disabled={busy || group.tasks.every((item) => item.phase === 'CANCELLING')}
          title={isBatch ? taskLabels.cancelBatch : l.cancel}
          aria-label={isBatch ? taskLabels.cancelBatch : l.cancel}
          onClick={() =>
            void onCancel(
              group.key,
              group.tasks.map((item) => item.runId),
            )
          }
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    );
  });
}

function BackgroundServiceStatus({
  reconnecting,
  codexHealth,
}: {
  reconnecting: boolean;
  codexHealth: CodexHealth | null;
}) {
  const l = useI18n().messages.app.generationStatus;
  return (
    <Collapsible className="border-t">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-xs font-normal whitespace-normal"
        >
          <ActivityIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-left">{l.serviceStatus}</span>
          {reconnecting && <span className="text-muted-foreground">{l.reconnecting}</span>}
          {codexHealth?.state === 'unavailable' && <span className="text-destructive">Codex · {l.unavailable}</span>}
          <ChevronDownIcon
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-2 text-xs">
          <span className="text-muted-foreground">{l.service}</span>
          <span>{reconnecting ? l.reconnecting : l.connected}</span>
          <span className="text-muted-foreground">Codex</span>
          <span className={codexHealth?.state === 'unavailable' ? 'text-destructive' : ''}>
            {codexHealth?.state === 'ready'
              ? l.available
              : codexHealth?.state === 'unavailable'
                ? l.unavailable
                : l.checking}
          </span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GenerationIssueRows({
  issues,
  busy,
  onReEdit,
  onRetry,
}: {
  issues: ReturnType<typeof generationIssues>;
  busy: boolean;
  onReEdit(runId: string): void;
  onRetry(runId: string): Promise<void>;
}) {
  const { messages } = useI18n();
  const l = messages.app.generationStatus;
  const backgroundIssues = useBackgroundIssues();
  return issues.map(({ run, title }) => (
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
        busy={busy || backgroundIssues.isPending(run.backgroundIssue)}
        reEditLabel={l.reEdit}
        retryLabel={l.retry}
        regenerateLabel={l.regenerate}
        dismissLabel={messages.creator.generationTasks.dismiss}
        onReEdit={() => onReEdit(run.id)}
        onRetry={() => void onRetry(run.id)}
        onDismiss={() => void backgroundIssues.acknowledge(run.backgroundIssue)}
      />
    </div>
  ));
}

export function GenerationStatusPopover({
  workerStatus,
  codexHealth,
  tasks,
  transcriptTasks,
  routes,
  assistantRuns,
  agentTasks,
  series,
  onCancel,
  onTranscriptCancel,
  onRetry,
  onReEdit,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const backgroundIssues = useBackgroundIssues();
  const { entries: deliveries } = useArticleDeliveries();
  const activeDeliveries = deliveries.filter(({ job }) => articleDeliveryActive(job));
  const failedDeliveries = deliveries.filter(({ job }) => job.status === 'FAILED');
  const completedDeliveries = deliveries.filter(({ job }) => job.status === 'SUCCEEDED').slice(0, 3);
  const l = messages.app.generationStatus;
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const titleBySeriesId = useMemo(() => new Map(series.map((item) => [item.id, item.title])), [series]);
  const modelNameByKey = useMemo(() => new Map(routes.map((model) => [model.key, model.name])), [routes]);
  const agentRunIds = useMemo(() => new Set(agentTasks.flatMap((task) => task.runIds)), [agentTasks]);
  const issues = useMemo(
    () => generationIssues(series, agentRunIds, backgroundIssues.isAcknowledged),
    [agentRunIds, backgroundIssues.isAcknowledged, series],
  );
  const activeAssistantRuns = useMemo(() => assistantRuns.filter((run) => run.status === 'RUNNING'), [assistantRuns]);
  const activeDirectorTasks = agentTasks.filter((task) => ACTIVE_DIRECTOR_STATUSES.has(task.status));
  const directorIssues = agentTasks
    .filter(
      (task) =>
        ['PARTIAL_SUCCESS', 'FAILED'].includes(task.status) && !backgroundIssues.isAcknowledged(task.backgroundIssue),
    )
    .slice(0, 3);
  const standaloneIssues = issues;
  const coveredRunIds = new Set(activeDirectorTasks.flatMap((task) => task.runIds));
  const visibleGenerationTasks = tasks.filter((task) => !coveredRunIds.has(task.runId));
  const visibleGenerationTaskGroups = groupGenerationTasks(visibleGenerationTasks);
  const coveredActiveRunCount = tasks.length - visibleGenerationTasks.length;
  const generationTaskCount = Math.max(0, (workerStatus?.generationTaskCount ?? tasks.length) - coveredActiveRunCount);
  const codexTaskCount = workerStatus?.codexTaskCount ?? activeAssistantRuns.length;
  const activeCount =
    generationTaskCount +
    codexTaskCount +
    activeDirectorTasks.length +
    transcriptTasks.length +
    activeDeliveries.length;
  const visibleAssistantRuns = activeAssistantRuns.slice(0, codexTaskCount);
  const otherCodexTaskCount = Math.max(0, codexTaskCount - visibleAssistantRuns.length);
  const reconnecting = !workerStatus || workerStatus.state === 'RECONNECTING';
  const attentionCount = standaloneIssues.length + directorIssues.length + failedDeliveries.length;
  const hasActiveTasks = activeCount > 0 || visibleGenerationTaskGroups.length > 0;

  useEffect(() => {
    if (!open || (!tasks.some((task) => task.status === 'RUNNING') && transcriptTasks.length === 0)) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open, tasks, transcriptTasks.length]);

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

  async function cancelTranscriptTask(operationId: string) {
    if (busyRunId) return;
    setBusyRunId(operationId);
    try {
      await onTranscriptCancel(operationId);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRunId(null);
    }
  }

  function reEdit(runId: string) {
    onReEdit(runId);
    setOpen(false);
  }

  const statusText = backgroundStatusText(l, reconnecting, activeCount, attentionCount);
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
          <StatusIcon className={backgroundTaskIconClassName(reconnecting, activeCount, attentionCount)} />
          <span>{l.backgroundTasks}</span>
          <span className="text-foreground">{statusText}</span>
          {attentionCount > 0 && (activeCount > 0 || reconnecting) && (
            <span className="text-destructive">{l.attention(attentionCount)}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={4}
        collisionPadding={8}
        aria-labelledby={headingId}
        className="max-h-[var(--radix-popover-content-available-height)] w-96 max-w-[calc(100vw-1rem)] overflow-y-auto p-0"
      >
        <h2 ref={headingRef} id={headingId} tabIndex={-1} className="border-b px-3 py-2 text-xs font-medium">
          {l.backgroundTasks}
        </h2>
        <div className="max-h-64 overflow-y-auto">
          {!hasActiveTasks && !attentionCount && !completedDeliveries.length && (
            <div className="px-3 py-3 text-xs text-muted-foreground">{l.idle}</div>
          )}
          {hasActiveTasks && (
            <section aria-labelledby={`${headingId}-active`} className="border-b last:border-b-0">
              <h3 id={`${headingId}-active`} className="px-3 pt-2 pb-1 text-2xs font-medium text-muted-foreground">
                {l.activeTasks}
              </h3>
              {activeDeliveries.map((entry) => (
                <ArticleDeliveryTaskItem
                  key={entry.job.id}
                  entry={entry}
                  onNavigate={() => setOpen(false)}
                  onDismiss={() => headingRef.current?.focus()}
                />
              ))}
              {transcriptTasks.map((task) => (
                <VideoDocumentTranscriptTaskCenterItem
                  key={task.operationId}
                  task={task}
                  nowMs={nowMs}
                  busy={Boolean(busyRunId)}
                  onCancel={() => void cancelTranscriptTask(task.operationId)}
                />
              ))}
              {activeDirectorTasks.map((task) => (
                <DirectionExperimentTaskCenterItem
                  key={task.id}
                  locale={locale}
                  task={task}
                  generationTasks={tasks.filter((run) => task.runIds.includes(run.runId))}
                />
              ))}
              <GenerationTaskRows
                groups={visibleGenerationTaskGroups}
                titleBySeriesId={titleBySeriesId}
                modelNameByKey={modelNameByKey}
                nowMs={nowMs}
                busy={Boolean(busyRunId)}
                onCancel={cancelTasks}
              />
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
            </section>
          )}
          {attentionCount > 0 && (
            <section aria-labelledby={`${headingId}-attention`} className="border-b last:border-b-0">
              <h3 id={`${headingId}-attention`} className="px-3 pt-2 pb-1 text-2xs font-medium text-muted-foreground">
                {l.needsAttention}
              </h3>
              {failedDeliveries.map((entry) => (
                <ArticleDeliveryTaskItem
                  key={entry.job.id}
                  entry={entry}
                  onNavigate={() => setOpen(false)}
                  onDismiss={() => headingRef.current?.focus()}
                />
              ))}
              {directorIssues.map((task) => (
                <DirectionExperimentTaskCenterItem
                  key={task.id}
                  locale={locale}
                  task={task}
                  generationTasks={tasks.filter((run) => task.runIds.includes(run.runId))}
                />
              ))}
              <GenerationIssueRows
                issues={standaloneIssues}
                busy={Boolean(busyRunId)}
                onReEdit={reEdit}
                onRetry={retry}
              />
            </section>
          )}
          {completedDeliveries.length > 0 && (
            <section aria-labelledby={`${headingId}-uploads`} className="border-b last:border-b-0">
              <h3 id={`${headingId}-uploads`} className="px-3 pt-2 pb-1 text-2xs font-medium text-muted-foreground">
                {l.recentUploads}
              </h3>
              {completedDeliveries.map((entry) => (
                <ArticleDeliveryTaskItem
                  key={entry.job.id}
                  entry={entry}
                  onNavigate={() => setOpen(false)}
                  onDismiss={() => headingRef.current?.focus()}
                />
              ))}
            </section>
          )}
        </div>
        <BackgroundServiceStatus reconnecting={reconnecting} codexHealth={codexHealth} />
      </PopoverContent>
    </Popover>
  );
}
