import type { WorkExecution, WorkSnapshot } from '@/shared/contracts/work-tracking';

export type ItemExecution = Pick<
  WorkExecution,
  'id' | 'title' | 'state' | 'phase' | 'result' | 'reference' | 'linkNote'
> & { executor: string; updatedAt: string };

/** Both reported runs and delegated attempts project onto the existing item identity. */
export function indexWorkItemExecutions(snapshot: WorkSnapshot) {
  const byItem = new Map<string, ItemExecution[]>();
  const add = (itemIds: string[], execution: ItemExecution) => {
    for (const id of new Set(itemIds)) {
      const entries = byItem.get(id) ?? [];
      entries.push(execution);
      byItem.set(id, entries);
    }
  };
  for (const execution of snapshot.executions ?? []) {
    add(execution.itemIds, {
      id: `reported:${execution.id}`,
      title: execution.title,
      executor: execution.executor.application,
      state: execution.state,
      phase: execution.phase,
      result: execution.result,
      reference: execution.reference,
      linkNote: execution.linkNote,
      updatedAt: execution.sourceUpdatedAt,
    });
  }
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  for (const attempt of snapshot.attempts) {
    const task = tasks.get(attempt.taskId);
    if (!task) continue;
    add(
      task.inputs.map((input) => input.itemId),
      {
        id: `attempt:${attempt.id}`,
        title: task.objective,
        executor: attempt.executor,
        state: attempt.state,
        phase: task.phase,
        result: attempt.result,
        reference: attempt.reference,
        linkNote: '',
        updatedAt: attempt.updatedAt,
      },
    );
  }
  for (const entries of byItem.values()) {
    entries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  }
  return byItem;
}
