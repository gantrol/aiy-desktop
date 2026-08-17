import type { ClassificationRow } from '@/main/database/dictionary/dictionary-classification-types';
import { text } from '@/main/database/core/values';

export function classificationRootRow(row: ClassificationRow, rows: Map<string, ClassificationRow>) {
  const visited = new Set<string>();
  let current = row;
  while (current.parent_id) {
    const id = text(current.id);
    if (visited.has(id)) throw new Error('Classification hierarchy contains a cycle');
    visited.add(id);
    const parent = rows.get(text(current.parent_id));
    if (!parent) throw new Error('Classification parent not found');
    current = parent;
  }
  return current;
}

export function classificationSubtreeIds(id: string, rows: Map<string, ClassificationRow>) {
  if (!rows.has(id)) throw new Error('Classification not found');
  const children = new Map<string, string[]>();
  for (const row of rows.values()) {
    if (!row.parent_id) continue;
    const parentId = text(row.parent_id);
    const ids = children.get(parentId) ?? [];
    ids.push(text(row.id));
    children.set(parentId, ids);
  }
  const result: string[] = [];
  const pending = [id];
  const visited = new Set<string>();
  while (pending.length) {
    const next = pending.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);
    result.push(next);
    pending.push(...(children.get(next) ?? []));
  }
  return result;
}

export function assertClassificationMoveTarget(
  id: string,
  parentId: string | null,
  rows: Map<string, ClassificationRow>,
) {
  if (id === parentId) throw new Error('A classification cannot be its own parent');
  if (!parentId) return;
  const parent = rows.get(parentId);
  if (!parent) throw new Error('Target classification not found');
  if (parent.state === 'DISABLED') throw new Error('A disabled classification cannot receive children');
  if (classificationSubtreeIds(id, rows).includes(parentId)) {
    throw new Error('A classification cannot be moved into one of its descendants');
  }
}

export function assertClassificationMergeTarget(
  sourceId: string,
  targetId: string,
  rows: Map<string, ClassificationRow>,
) {
  if (sourceId === targetId) throw new Error('Choose a different target classification');
  const target = rows.get(targetId);
  if (!rows.has(sourceId) || !target) throw new Error('Classification not found');
  if (target.state === 'DISABLED') throw new Error('A disabled classification cannot be a merge target');
  if (
    classificationSubtreeIds(sourceId, rows).includes(targetId) ||
    classificationSubtreeIds(targetId, rows).includes(sourceId)
  ) {
    throw new Error('A classification cannot be merged with one of its ancestors or descendants');
  }
}
