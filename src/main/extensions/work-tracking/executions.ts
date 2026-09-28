import { randomUUID } from 'node:crypto';
import type { WorkMutation, WorkState } from '@/shared/contracts/work-tracking';
import { WorkTrackingError } from '@/main/extensions/work-tracking/errors';

export function recordWorkExecution(state: WorkState, input: Extract<WorkMutation, { action: 'recordExecution' }>) {
  if (new Set(input.itemIds).size !== input.itemIds.length) throw new WorkTrackingError('invalidInput');
  if (input.itemIds.some((id) => !state.items.some((item) => item.id === id)))
    throw new WorkTrackingError('missingItem');
  if (input.itemIds.length && !input.linkNote) throw new WorkTrackingError('evidenceRequired');
  if (input.startedAt && input.completedAt && Date.parse(input.completedAt) < Date.parse(input.startedAt))
    throw new WorkTrackingError('invalidInput');
  const previous = state.executions.find(
    (entry) => entry.executor.application === input.executor.application && entry.externalId === input.externalId,
  );
  if (previous && Date.parse(previous.sourceUpdatedAt) > Date.parse(input.sourceUpdatedAt))
    throw new WorkTrackingError('conflict');
  const {
    spaceId: _spaceId,
    revision: _revision,
    requestId: _requestId,
    note: _note,
    action: _action,
    ...fields
  } = input;
  const time = new Date().toISOString();
  const next = {
    ...fields,
    id: previous?.id ?? randomUUID(),
    recordedAt: previous?.recordedAt ?? time,
    updatedAt: time,
  };
  const before = previous ? JSON.stringify(previous) : '';
  const relatedItemIds = [...new Set([...(previous?.itemIds ?? []), ...input.itemIds])];
  if (previous) Object.assign(previous, next);
  else state.executions.push(next);
  return { targetId: next.id, relatedItemIds, before, after: JSON.stringify(next) };
}
