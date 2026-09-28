import { LoaderCircleIcon } from 'lucide-react';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { generationPhaseLabel } from '@/renderer/components/generation/task-presentation';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { PromptSeriesDto } from '@/shared/contracts';

function outputGenerationState(model: CreatorScreenViewModel) {
  const { workbench } = model;
  const seriesById = new Map<string, PromptSeriesDto>();
  for (const series of [workbench.outputSeries, workbench.outputPrimarySeries]) {
    if (series) seriesById.set(series.id, series);
  }
  for (const group of workbench.outputProjection) {
    for (const stack of group.directionStacks) {
      if (stack.series) seriesById.set(stack.series.id, stack.series);
    }
  }
  const tasks = model.app.data.generationTasks.filter((task) => seriesById.has(task.seriesId));
  const task = tasks.find((item) => item.status === 'RUNNING') ?? tasks[0];
  // Persisted runs bridge the gap between a task event and the refreshed output projection.
  const runs = [...seriesById.values()].flatMap((series) => series.versions.flatMap((version) => version.runs));
  const run = task
    ? runs.find((item) => item.id === task.runId)
    : (runs.find((item) => item.status === 'RUNNING') ?? runs.find((item) => item.status === 'QUEUED'));
  const starting =
    model.generationRuntime.launch.starting &&
    (!workbench.outputSeries || workbench.outputSeries.id === workbench.series?.id);
  return { task, run, starting };
}

export function CreatorOutputEmptyState({ model }: { model: CreatorScreenViewModel }) {
  const { messages } = useI18n();
  const labels = messages.creator.workNavigation;
  const phases = messages.creator.generationTasks;
  const { task, run, starting } = outputGenerationState(model);
  const pending = Boolean(task || run || starting);
  const status = task
    ? generationPhaseLabel(task, phases)
    : run
      ? run.status === 'QUEUED'
        ? phases.queued
        : phases.generating
      : phases.preparing;
  const aspectRatio = run?.width && run.height ? run.width / run.height : 1;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        {pending && (
          <div aria-hidden="true" className="relative grid w-48 max-w-full place-items-center" style={{ aspectRatio }}>
            <Skeleton className="absolute inset-0 rounded-sm motion-reduce:animate-none" />
            <LoaderCircleIcon className="relative size-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        )}
        <span role="status" aria-live="polite" aria-atomic="true" className="text-center text-sm font-semibold">
          {pending ? status : labels.emptyOutput}
        </span>
        <Button type="button" variant="secondary" onClick={() => model.projection.panes.setCompactPanel('creator')}>
          {labels.backToInput}
        </Button>
      </div>
    </div>
  );
}
