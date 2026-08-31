import { useEffect, useMemo, useState } from 'react';
import { RotateCcwIcon, XIcon } from 'lucide-react';
import type { ImageGenerationRouteDto, GenerationTaskDto, PromptSeriesDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { StatusDot } from '@/renderer/components/ui/status-dot';
import { generationElapsed, generationPhaseLabel } from '@/renderer/components/generation/task-presentation';
import { groupGenerationTasks, leadGenerationTask } from '@/renderer/components/generation/generationTaskGroups';
import { GenerationErrorNotice } from '@/renderer/components/generation/GenerationErrorNotice';
import { useBackgroundIssues } from '@/renderer/features/background-issues/BackgroundIssueProvider';

interface Props {
  tasks: GenerationTaskDto[];
  routes: ImageGenerationRouteDto[];
  series: PromptSeriesDto | undefined;
  allSeries: PromptSeriesDto[];
  onCancel(runId: string): Promise<void>;
  onRetry(runId: string): Promise<void>;
  notify(message: string): void;
}

export function GenerationTaskTray({ tasks, routes, series, allSeries, onCancel, onRetry, notify }: Props) {
  const l = useI18n().messages.creator.generationTasks;
  const backgroundIssues = useBackgroundIssues();
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [busyCancelKey, setBusyCancelKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const titleBySeriesId = useMemo(() => new Map(allSeries.map((item) => [item.id, item.title])), [allSeries]);
  const modelNameByKey = useMemo(() => new Map(routes.map((model) => [model.key, model.name])), [routes]);
  const taskGroups = useMemo(() => groupGenerationTasks(tasks), [tasks]);
  const failures = useMemo(() => {
    const runs = (series?.versions ?? []).flatMap((version) => version.runs);
    const retried = new Set(runs.flatMap((run) => (run.retryOfRunId ? [run.retryOfRunId] : [])));
    return runs
      .filter(
        (run) =>
          ['FAILED', 'INTERRUPTED'].includes(run.status) &&
          !retried.has(run.id) &&
          !backgroundIssues.isAcknowledged(run.backgroundIssue),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, 2);
  }, [backgroundIssues, series]);

  useEffect(() => {
    if (!tasks.some((task) => task.status === 'RUNNING')) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [tasks]);

  if (!tasks.length && !failures.length) return null;

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

  async function cancelTasks(key: string, runIds: string[]) {
    if (busyCancelKey) return;
    setBusyCancelKey(key);
    try {
      await Promise.all(runIds.map((runId) => onCancel(runId)));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyCancelKey(null);
    }
  }

  return (
    <section className="max-h-36 shrink-0 overflow-y-auto border-t bg-background" aria-live="polite">
      {taskGroups.map((group) => {
        const task = leadGenerationTask(group);
        const title = titleBySeriesId.get(task.seriesId) ?? task.runId.slice(-6);
        const elapsed = generationElapsed(task, nowMs);
        const modelSummary = group.modelKeys.map((key) => modelNameByKey.get(key) ?? key).join(' + ');
        const isBatch = Boolean(group.batchId);
        return (
          <div
            key={group.key}
            data-generation-task={isBatch ? undefined : task.runId}
            data-generation-batch={group.batchId ?? undefined}
            className="flex h-9 items-center gap-2 border-b px-3 text-xs last:border-b-0"
          >
            <StatusDot variant="pending" label={generationPhaseLabel(task, l)} />
            <span
              className="min-w-0 flex-1 truncate font-medium"
              title={modelSummary ? `${title} · ${modelSummary}` : title}
            >
              {title}
            </span>
            <MetaText aria-hidden="true" className="shrink-0">
              {generationPhaseLabel(task, l)}
              {isBatch
                ? ` · ${l.batchModels(group.modelKeys.length)} · ${l.batchProgress(group.completedCount, group.totalCount)}`
                : ''}
              {elapsed ? ` · ${elapsed}` : ''}
            </MetaText>
            <Button
              type="button"
              data-action={isBatch ? 'cancel-generation-batch' : 'cancel-generation'}
              variant="ghost"
              size="icon-sm"
              className="size-7"
              disabled={Boolean(busyCancelKey) || group.tasks.every((item) => item.phase === 'CANCELLING')}
              title={isBatch ? l.cancelBatch : l.cancel}
              aria-label={isBatch ? l.cancelBatch : l.cancel}
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
      {failures.map((run) => (
        <div
          key={run.id}
          data-generation-error={run.id}
          className="flex min-h-9 items-center gap-2 border-b px-3 py-1 text-xs last:border-b-0"
        >
          <StatusDot variant="error" label={run.status === 'INTERRUPTED' ? l.interrupted : l.failed} />
          <GenerationErrorNotice run={run} showIcon={false} className="min-w-0 flex-1" summaryClassName="truncate" />
          <Button
            type="button"
            data-action="retry-generation"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={Boolean(busyRunId)}
            onClick={() => void retry(run.id)}
          >
            <RotateCcwIcon className="size-3" />
            {run.status === 'INTERRUPTED' ? l.regenerate : l.retry}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7"
            title={l.dismiss}
            aria-label={l.dismiss}
            disabled={backgroundIssues.isPending(run.backgroundIssue)}
            onClick={() => void backgroundIssues.acknowledge(run.backgroundIssue)}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      ))}
    </section>
  );
}
