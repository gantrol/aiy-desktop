import type { GenerationTaskDto } from '@/shared/contracts';

export interface GenerationTaskGroup {
  key: string;
  batchId: string | null;
  tasks: GenerationTaskDto[];
  totalCount: number;
  completedCount: number;
  modelKeys: string[];
}

export function groupGenerationTasks(tasks: readonly GenerationTaskDto[]): GenerationTaskGroup[] {
  const groups = new Map<string, GenerationTaskDto[]>();
  for (const task of tasks) {
    const key = task.batchId ? `batch:${task.batchId}` : `run:${task.runId}`;
    const current = groups.get(key);
    if (current) current.push(task);
    else groups.set(key, [task]);
  }

  return [...groups.entries()].map(([key, groupedTasks]) => {
    const first = groupedTasks[0];
    const batchId = first.batchId ?? null;
    const totalCount = batchId ? Math.max(groupedTasks.length, ...groupedTasks.map((task) => task.batchTotal ?? 0)) : 1;
    const modelKeys =
      batchId && first.batchModelKeys?.length
        ? [...new Set(first.batchModelKeys)]
        : [...new Set(groupedTasks.map((task) => task.modelKey))];
    return {
      key,
      batchId,
      tasks: groupedTasks,
      totalCount,
      completedCount: Math.max(0, totalCount - groupedTasks.length),
      modelKeys,
    };
  });
}

export function leadGenerationTask(group: GenerationTaskGroup) {
  return (
    group.tasks.find((task) => task.phase === 'CANCELLING') ??
    group.tasks.find((task) => task.status === 'RUNNING') ??
    group.tasks[0]
  );
}
