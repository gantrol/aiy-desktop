import type { BlockNode } from '@/shared/contracts/block-document';
import {
  canMoveOutlineStructure,
  outlineItemRecords,
  outlineSelectionRoots,
  type OutlineDropPlacement,
} from '@/renderer/features/content-editor/outlineMove';

export type OutlineBatchMoveAction = 'indent' | 'outdent' | 'move_up' | 'move_down';

export interface OutlineBatchMovePlan {
  roots: string[];
  targetId: string;
  placement: OutlineDropPlacement;
  expandTarget: boolean;
}

/**
 * Plan against the visible forest before changing anything. A selection can cross
 * parents, but its roots and complete subtrees must cover one unbroken interval.
 */
export function planOutlineBatchMove(input: {
  document: BlockNode;
  selectedIds: readonly string[];
  visibleIds: readonly string[];
  focus: string | null;
  action: OutlineBatchMoveAction;
}): OutlineBatchMovePlan | null {
  const records = outlineItemRecords(input.document);
  const roots = outlineSelectionRoots(input.document, input.selectedIds);
  const visible = new Set(input.visibleIds);
  if (!roots.length || roots.some((id) => !visible.has(id) || id === input.focus)) return null;
  if (input.focus && roots.some((id) => !records.get(id)!.ancestors.includes(input.focus!))) return null;
  const rootIds = new Set(roots);
  const covered = new Set(
    [...records]
      .filter(([id, row]) => rootIds.has(id) || row.ancestors.some((id) => rootIds.has(id)))
      .map(([id]) => id),
  );
  const indexes = input.visibleIds.flatMap((id, index) => (covered.has(id) ? [index] : []));
  if (!indexes.length || input.visibleIds.slice(indexes[0], indexes.at(-1)! + 1).some((id) => !covered.has(id)))
    return null;

  const parentOf = (id: string) => records.get(id)!.ancestors.at(-1) ?? null;
  const siblingsOf = (id: string) => [...records.keys()].filter((candidate) => parentOf(candidate) === parentOf(id));
  const first = roots[0];
  const last = roots.at(-1)!;
  let targetId: string | undefined;
  let placement: OutlineDropPlacement;
  if (input.action === 'indent') {
    const siblings = siblingsOf(first);
    targetId = siblings[siblings.indexOf(first) - 1];
    placement = 'INSIDE';
  } else if (input.action === 'outdent') {
    targetId = parentOf(first) ?? undefined;
    placement = 'AFTER';
  } else if (input.action === 'move_up') {
    const siblings = siblingsOf(first);
    targetId =
      siblings
        .slice(0, siblings.indexOf(first))
        .filter((id) => !rootIds.has(id))
        .at(-1) ??
      parentOf(first) ??
      undefined;
    placement = 'BEFORE';
  } else {
    const siblings = siblingsOf(last);
    targetId = siblings.slice(siblings.indexOf(last) + 1).find((id) => !rootIds.has(id)) ?? parentOf(last) ?? undefined;
    placement = 'AFTER';
  }
  if (!targetId || (targetId === input.focus && placement !== 'INSIDE')) return null;
  if (input.focus && targetId !== input.focus && !records.get(targetId)!.ancestors.includes(input.focus)) return null;
  if (!canMoveOutlineStructure(input.document, roots, targetId)) return null;
  return { roots, targetId, placement, expandTarget: input.action === 'indent' };
}
