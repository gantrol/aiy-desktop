import { CheckIcon, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EvaluationCase, Locale } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import {
  evaluationTaskLibrary,
  instantiateEvaluationTask,
  lifecyclePhaseLabel,
  lifecyclePhases,
  localizedText,
  taskPhasePrompt,
  taskTemplateTag,
  type EvaluationTaskReadiness,
  type EvaluationTaskTemplate,
} from '@/renderer/features/evaluations/evaluation-task-library';
import { cn } from '@/renderer/lib/utils';

interface Props {
  cases: readonly EvaluationCase[];
  locale: Locale;
  onCasesChange(cases: EvaluationCase[]): void;
  onSelectedCaseIdChange(id: string): void;
  onOpenCases(): void;
}

function difficultyLabel(difficulty: EvaluationTaskTemplate['difficulty'], locale: Locale) {
  const labels =
    locale === 'zh'
      ? { SMALL: '小型', MEDIUM: '中型', LARGE: '大型' }
      : { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' };
  return labels[difficulty];
}

function weightForPhase(phase: (typeof lifecyclePhases)[number]) {
  return evaluationTaskLibrary.rubric
    .filter((criterion) => criterion.phase === phase)
    .reduce((sum, criterion) => sum + criterion.weight, 0);
}

export function EvaluationTaskLibrary({ cases, locale, onCasesChange, onSelectedCaseIdChange, onOpenCases }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState(evaluationTaskLibrary.tasks[0]?.id ?? '');
  const [readinessFilter, setReadinessFilter] = useState<EvaluationTaskReadiness>('READY');
  const visibleTasks = evaluationTaskLibrary.tasks.filter((task) => task.readiness === readinessFilter);
  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0];
  const readinessCounts = evaluationTaskLibrary.tasks.reduce(
    (counts, task) => ({ ...counts, [task.readiness]: counts[task.readiness] + 1 }),
    { READY: 0, DRAFT: 0 } satisfies Record<EvaluationTaskReadiness, number>,
  );
  const importedTemplateIds = useMemo(
    () =>
      new Set(
        evaluationTaskLibrary.tasks
          .filter((task) => cases.some((evaluationCase) => evaluationCase.tags.includes(taskTemplateTag(task.id))))
          .map((task) => task.id),
      ),
    [cases],
  );
  const labels =
    locale === 'zh'
      ? {
          library: '题库',
          ready: '就绪',
          draft: '草稿',
          readiness: '题库状态',
          add: '加入评测集',
          added: '已加入',
          source: '来源',
          acceptance: '验收',
          rubric: '评分',
          gate: '门槛',
          points: '分',
        }
      : {
          library: 'Task bank',
          ready: 'Ready',
          draft: 'Draft',
          readiness: 'Task status',
          add: 'Add to suite',
          added: 'Added',
          source: 'Source',
          acceptance: 'Acceptance',
          rubric: 'Scoring',
          gate: 'Gate',
          points: 'pts',
        };

  if (!selectedTask) return null;
  const imported = importedTemplateIds.has(selectedTask.id);
  const selectable = selectedTask.readiness === 'READY';

  function addSelectedTask() {
    if (imported || !selectable) return;
    const evaluationCase = instantiateEvaluationTask(selectedTask, locale, () => window.crypto.randomUUID());
    onCasesChange([...cases, evaluationCase]);
    onSelectedCaseIdChange(evaluationCase.id);
    onOpenCases();
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r bg-surface-sunken">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-2 text-xs font-semibold">
          <span className="shrink-0">
            {labels.library} · {visibleTasks.length}
          </span>
          <Segmented
            type="single"
            value={readinessFilter}
            aria-label={labels.readiness}
            onValueChange={(value) => {
              if (value === 'READY' || value === 'DRAFT') setReadinessFilter(value);
            }}
          >
            <SegmentedItem value="READY" className="px-2">
              {labels.ready} · {readinessCounts.READY}
            </SegmentedItem>
            <SegmentedItem value="DRAFT" className="px-2">
              {labels.draft} · {readinessCounts.DRAFT}
            </SegmentedItem>
          </Segmented>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 p-1.5">
            {visibleTasks.map((task, index) => {
              const taskImported = importedTemplateIds.has(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  className={cn(
                    'flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-hover',
                    task.id === selectedTask.id && 'bg-selected text-selected-foreground hover:bg-selected',
                  )}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{localizedText(task.title, locale)}</span>
                  {taskImported ? <CheckIcon className="size-3.5 text-success" aria-label={labels.added} /> : null}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-5 py-2">
          <strong className="min-w-0 flex-1 truncate text-sm font-semibold">
            {localizedText(selectedTask.title, locale)}
          </strong>
          <Badge variant="outline">{selectedTask.readiness === 'READY' ? labels.ready : labels.draft}</Badge>
          <Badge variant="outline">{difficultyLabel(selectedTask.difficulty, locale)}</Badge>
          <Button type="button" size="sm" disabled={imported || !selectable} onClick={addSelectedTask}>
            {imported ? <CheckIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            {imported ? labels.added : labels.add}
          </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto grid w-full max-w-5xl gap-7 p-5 pb-12">
            <div className="grid gap-1 border-b pb-3 text-xs sm:grid-cols-[6rem_minmax(0,1fr)]">
              <span className="text-muted-foreground">{labels.source}</span>
              <span className="min-w-0 break-all tabular-nums" title={selectedTask.source.url ?? undefined}>
                {localizedText(selectedTask.source.label, locale)} · {selectedTask.source.revision}
              </span>
            </div>

            <Tabs defaultValue="IDEATION">
              <TabsList>
                {lifecyclePhases.map((phase) => (
                  <TabsTrigger key={phase} value={phase}>
                    {lifecyclePhaseLabel(phase, locale)} · {weightForPhase(phase)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {lifecyclePhases.map((phase) => (
                <TabsContent key={phase} value={phase} className="pt-4">
                  <div className="whitespace-pre-wrap text-sm leading-6">
                    {taskPhasePrompt(selectedTask, phase, locale)}
                  </div>
                </TabsContent>
              ))}
            </Tabs>

            <section className="grid gap-3">
              <strong className="border-b pb-2 text-sm font-semibold">{labels.acceptance}</strong>
              <div className="whitespace-pre-wrap text-sm leading-6">
                {localizedText(selectedTask.expected, locale)}
              </div>
            </section>

            <section className="grid gap-1">
              <strong className="border-b pb-2 text-sm font-semibold">{labels.rubric} · 100</strong>
              {evaluationTaskLibrary.rubric.map((criterion) => (
                <div
                  key={criterion.key}
                  className="grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start"
                >
                  <span className="text-xs font-medium">{lifecyclePhaseLabel(criterion.phase, locale)}</span>
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">{localizedText(criterion.label, locale)}</span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      {localizedText(criterion.description, locale)}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2 text-xs tabular-nums">
                    {criterion.isGate ? <Badge variant="outline">{labels.gate}</Badge> : null}
                    <span>
                      {criterion.weight} {labels.points}
                    </span>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
