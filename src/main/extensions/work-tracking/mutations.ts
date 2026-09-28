import { randomUUID } from 'node:crypto';
import type { WorkItem, WorkMutation, WorkState } from '@/shared/contracts/work-tracking';
import { WorkTrackingError } from '@/main/extensions/work-tracking/errors';
import type { WorkTrackingSources } from '@/main/extensions/work-tracking/sources';
import { recordWorkExecution } from '@/main/extensions/work-tracking/executions';

const activeAttempt = (state: string) => state === 'RUNNING' || state === 'WAITING' || state === 'UNKNOWN';
const summarize = (value: unknown) => JSON.stringify(value);

function trackedItem(
  input: { creationItemId: string; descriptionFormId: string; kind: WorkItem['kind']; owner: string },
  articleId: string,
): WorkItem {
  const time = new Date().toISOString();
  return {
    id: input.creationItemId,
    descriptionFormId: input.descriptionFormId,
    articleId,
    kind: input.kind,
    state: 'DRAFT',
    owner: input.owner,
    priority: 'NONE',
    acceptance: '',
    enabled: true,
    resolution: null,
    duplicateOf: null,
    evidence: '',
    revision: 1,
    createdAt: time,
    updatedAt: time,
  };
}

function trackBatch(
  state: WorkState,
  input: Extract<WorkMutation, { action: 'trackBatch' }>,
  sources: WorkTrackingSources,
) {
  const selected = new Set(input.entries.map((entry) => entry.creationItemId));
  if (selected.size !== input.entries.length) throw new WorkTrackingError('invalidInput');
  if (state.items.some((item) => selected.has(item.id))) throw new WorkTrackingError('conflict');
  const articles = sources.batchArticles(input);
  const items = input.entries.map((entry) => ({
    ...trackedItem({ ...entry, kind: input.kind, owner: input.owner }, articles.get(entry.creationItemId)!),
    state: input.initialState ?? 'DRAFT',
  }));
  state.items.push(...items);
  return {
    targetId: input.albumId,
    relatedItemIds: [...selected],
    before: '',
    after: summarize({
      kind: input.kind,
      owner: input.owner,
      state: input.initialState ?? 'DRAFT',
      itemIds: [...selected],
    }),
  };
}

function findItem(state: WorkState, id: string) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) throw new WorkTrackingError('missingItem');
  return item;
}

function validateItem(state: WorkState, item: WorkItem) {
  if (item.state !== 'CLOSED') {
    if (item.resolution || item.duplicateOf || item.evidence) throw new WorkTrackingError('invalidInput');
    return;
  }
  if (item.resolution !== 'DUPLICATE') {
    if (item.duplicateOf) throw new WorkTrackingError('invalidInput');
    return;
  }
  const seen = new Set([item.id]);
  let target = item.duplicateOf;
  if (!target) throw new WorkTrackingError('invalidInput');
  while (target) {
    if (seen.has(target)) throw new WorkTrackingError('invalidInput');
    seen.add(target);
    target = findItem(state, target).duplicateOf;
  }
}

function changeItem(
  state: WorkState,
  input: Extract<WorkMutation, { action: 'track' | 'updateItem' }>,
  sources: WorkTrackingSources,
) {
  const time = new Date().toISOString();
  if (input.action === 'track') {
    if (state.items.some((item) => item.id === input.creationItemId)) throw new WorkTrackingError('conflict');
    const article = sources.article(input.creationItemId, input.descriptionFormId);
    const item = trackedItem(input, article.id);
    state.items.push(item);
    return { targetId: item.id, before: '', after: summarize(item) };
  }
  const item = findItem(state, input.itemId);
  const next = { ...item, ...input.fields, revision: item.revision + 1, updatedAt: time };
  if (input.fields.state && input.fields.state !== 'CLOSED') {
    next.resolution = null;
    next.duplicateOf = null;
    next.evidence = '';
  }
  validateItem(state, next);
  const before = summarize(item);
  Object.assign(item, next);
  return { targetId: item.id, before, after: summarize(item) };
}

function changeTask(
  state: WorkState,
  input: Extract<WorkMutation, { action: 'createTask' | 'assignTask' }>,
  sources: WorkTrackingSources,
) {
  if (input.action === 'createTask') {
    if (new Set(input.itemIds).size !== input.itemIds.length) throw new WorkTrackingError('invalidInput');
    const items = input.itemIds.map((id) => findItem(state, id));
    if (items.some((item) => !item.enabled || item.state === 'CLOSED'))
      throw new WorkTrackingError('invalidTransition');
    if (input.phase === 'development') {
      if (items.some((item) => !['READY', 'IN_PROGRESS', 'VERIFY'].includes(item.state)))
        throw new WorkTrackingError('invalidTransition');
      if (items.some((item) => !item.acceptance)) throw new WorkTrackingError('acceptanceRequired');
    }
    const task = sources.task(input, items);
    state.tasks.push(task);
    return {
      targetId: task.id,
      before: '',
      after: summarize({ executor: task.executor, itemIds: input.itemIds, objective: task.objective }),
    };
  }
  const task = state.tasks.find((entry) => entry.id === input.taskId);
  if (!task) throw new WorkTrackingError('missingTask');
  const before = task.executor;
  task.executor = input.executor;
  task.updatedAt = new Date().toISOString();
  return { targetId: task.id, before, after: task.executor };
}

function changeAttempt(state: WorkState, input: Extract<WorkMutation, { action: 'recordAttempt' | 'updateAttempt' }>) {
  const time = new Date().toISOString();
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(input.state) && !input.result)
    throw new WorkTrackingError('evidenceRequired');
  if (input.action === 'recordAttempt') {
    const task = state.tasks.find((entry) => entry.id === input.taskId);
    if (!task) throw new WorkTrackingError('missingTask');
    if (state.attempts.some((attempt) => attempt.taskId === task.id && activeAttempt(attempt.state)))
      throw new WorkTrackingError('invalidTransition');
    const attempt = {
      id: randomUUID(),
      taskId: task.id,
      executor: task.executor,
      state: input.state,
      result: input.result,
      reference: input.reference,
      provenance: 'MANUAL' as const,
      recordedAt: time,
      updatedAt: time,
    };
    state.attempts.push(attempt);
    return { targetId: attempt.id, before: '', after: summarize(attempt) };
  }
  const attempt = state.attempts.find((entry) => entry.id === input.attemptId);
  if (!attempt) throw new WorkTrackingError('missingAttempt');
  if (!activeAttempt(attempt.state)) throw new WorkTrackingError('invalidTransition');
  const before = summarize(attempt);
  Object.assign(attempt, { state: input.state, result: input.result, reference: input.reference, updatedAt: time });
  return { targetId: attempt.id, before, after: summarize(attempt) };
}

export function mutateWorkState(state: WorkState, input: WorkMutation, sources: WorkTrackingSources) {
  if (input.action === 'recordExecution') return recordWorkExecution(state, input);
  if (input.action === 'trackBatch') return trackBatch(state, input, sources);
  if (input.action === 'updateItems') {
    if (new Set(input.itemIds).size !== input.itemIds.length) throw new WorkTrackingError('invalidInput');
    const changes = input.itemIds.map((itemId) =>
      changeItem(state, { ...input, action: 'updateItem', itemId }, sources),
    );
    return {
      targetId: input.itemIds[0]!,
      relatedItemIds: input.itemIds,
      before: summarize(
        changes.map((change) => {
          const item = JSON.parse(change.before) as WorkItem;
          return { id: item.id, kind: item.kind, owner: item.owner, priority: item.priority };
        }),
      ),
      after: summarize(input.fields),
    };
  }
  if (input.action === 'track' || input.action === 'updateItem') return changeItem(state, input, sources);
  if (input.action === 'createTask' || input.action === 'assignTask') return changeTask(state, input, sources);
  return changeAttempt(state, input);
}
