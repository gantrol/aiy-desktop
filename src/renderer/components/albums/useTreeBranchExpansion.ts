import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTreeBranchReveal } from '@/renderer/components/albums/useTreeBranchReveal';
import {
  hasTreeBranchVerticalTravel,
  trackTreeBranchRetreat,
} from '@/renderer/components/albums/treeBranchInteraction';

export type TreeBranchDiagnosticValue = string | number | boolean | null;
export type TreeBranchDiagnosticSink = (
  name: string,
  details?: Readonly<Record<string, TreeBranchDiagnosticValue | undefined>>,
) => void;

interface RetreatOrigin {
  originY: number;
}

function getTreeNodeCenters(
  viewport: HTMLDivElement | null,
  activeBranchId: string,
  diagnostics?: TreeBranchDiagnosticSink,
) {
  const centers = new Map<string, number>();
  if (!viewport) {
    diagnostics?.('tree.pointer.geometry', { activeBranchId, outcome: 'missing-viewport', rowCount: 0 });
    return centers;
  }
  const startedAt = diagnostics ? performance.now() : 0;
  for (const row of viewport.querySelectorAll<HTMLElement>('[data-tree-node-id]')) {
    const branchId = row.dataset.treeNodeId;
    if (!branchId) continue;
    const rect = row.getBoundingClientRect();
    centers.set(branchId, rect.top + rect.height / 2);
  }
  diagnostics?.('tree.pointer.geometry', {
    activeBranchId,
    durationMs: performance.now() - startedAt,
    outcome: 'measured',
    rowCount: centers.size,
  });
  return centers;
}

/**
 * Keeps deliberate expansion separate from gesture expansion. A branch
 * opened by pulling downward stays latched open until the pointer slides
 * upward across its preview. Pointer leave, row clicks, and movement in the
 * child list do not release that latch; an explicit menu or rail action does.
 */
export function useTreeBranchExpansion(
  viewportRef: RefObject<HTMLDivElement | null>,
  initialPersistentIds: readonly string[] = [],
  diagnostics?: TreeBranchDiagnosticSink,
) {
  const [persistentIds, setPersistentIds] = useState<Set<string>>(() => new Set(initialPersistentIds));
  const [gestureIds, setGestureIds] = useState<Set<string>>(() => new Set());
  const openIds = useMemo(() => new Set([...persistentIds, ...gestureIds]), [gestureIds, persistentIds]);
  const requestReveal = useTreeBranchReveal(viewportRef, openIds, diagnostics);
  const persistentIdsRef = useRef(persistentIds);
  const gestureIdsRef = useRef(gestureIds);
  const pointerYByBranch = useRef(new Map<string, number>());
  const retreatByBranch = useRef(new Map<string, RetreatOrigin>());

  const updatePersistent = useCallback((updater: (current: Set<string>) => Set<string>) => {
    setPersistentIds((current) => {
      const next = updater(current);
      persistentIdsRef.current = next;
      return next;
    });
  }, []);

  const clearGestureMany = useCallback((branchIds: ReadonlySet<string>) => {
    for (const branchId of branchIds) retreatByBranch.current.delete(branchId);
    if (![...branchIds].some((branchId) => gestureIdsRef.current.has(branchId))) return;
    const next = new Set(gestureIdsRef.current);
    for (const branchId of branchIds) next.delete(branchId);
    gestureIdsRef.current = next;
    setGestureIds(next);
  }, []);

  const collapse = useCallback(
    (branchId: string) => {
      diagnostics?.('tree.expansion.requested', {
        branchId,
        gestureBefore: gestureIdsRef.current.has(branchId),
        persistentBefore: persistentIdsRef.current.has(branchId),
        requestedOpen: false,
      });
      clearGestureMany(new Set([branchId]));
      updatePersistent((current) => {
        if (!current.has(branchId)) return current;
        const next = new Set(current);
        next.delete(branchId);
        return next;
      });
    },
    [clearGestureMany, diagnostics, updatePersistent],
  );

  const setPersistent = useCallback(
    (branchId: string, open: boolean, reveal = true) => {
      if (!open) {
        collapse(branchId);
        return;
      }
      diagnostics?.('tree.expansion.requested', {
        branchId,
        gestureBefore: gestureIdsRef.current.has(branchId),
        persistentBefore: persistentIdsRef.current.has(branchId),
        requestedOpen: true,
      });
      // Deliberate expansion converts a temporary gesture state into a
      // persistent state, so later upward pointer travel cannot undo it.
      if (gestureIdsRef.current.has(branchId)) {
        clearGestureMany(new Set([branchId]));
      }
      if (persistentIdsRef.current.has(branchId)) {
        diagnostics?.('tree.expansion.skipped', { branchId, reason: 'already-open', requestedOpen: true });
        return;
      }
      updatePersistent((current) => {
        if (current.has(branchId)) return current;
        const next = new Set(current);
        next.add(branchId);
        return next;
      });
      if (reveal) requestReveal(branchId);
    },
    [clearGestureMany, collapse, diagnostics, updatePersistent, requestReveal],
  );

  const togglePersistent = useCallback(
    (branchId: string) => {
      setPersistent(branchId, !persistentIdsRef.current.has(branchId));
    },
    [setPersistent],
  );

  function expandFromGesture(branchId: string) {
    diagnostics?.('tree.expansion.requested', {
      branchId,
      gestureBefore: gestureIdsRef.current.has(branchId),
      persistentBefore: persistentIdsRef.current.has(branchId),
      requestedOpen: true,
      source: 'gesture',
    });
    if (persistentIdsRef.current.has(branchId)) return;
    const originY = pointerYByBranch.current.get(branchId);
    if (originY !== undefined) {
      retreatByBranch.current.set(branchId, {
        originY,
      });
    }
    if (gestureIdsRef.current.has(branchId)) return;
    const next = new Set(gestureIdsRef.current);
    next.add(branchId);
    gestureIdsRef.current = next;
    setGestureIds(next);
    requestReveal(branchId);
  }

  function beginPointerTrack(branchId: string, clientY: number) {
    diagnostics?.('tree.pointer.entered', { branchId, clientY });
    samplePointer(branchId, clientY, 'enter');
  }

  function samplePointer(branchId: string, clientY: number, phase: 'enter' | 'move'): boolean {
    pointerYByBranch.current.set(branchId, clientY);
    const retreatedIds = new Set<string>();

    if (phase === 'enter') {
      const currentRetreat = retreatByBranch.current.get(branchId);
      if (currentRetreat) {
        const tracked = trackTreeBranchRetreat(currentRetreat.originY, clientY);
        if (tracked.retreated) retreatedIds.add(branchId);
        else currentRetreat.originY = clientY;
      }

      // A jump between previews is judged by their current visual order, not
      // by another branch's pointer baseline. This survives viewport auto-scroll
      // and prevents movement on a lower child from folding its parent.
      const rowCenters = getTreeNodeCenters(viewportRef.current, branchId, diagnostics);
      const activeCenterY = rowCenters.get(branchId);
      if (activeCenterY !== undefined) {
        for (const trackedBranchId of retreatByBranch.current.keys()) {
          if (trackedBranchId === branchId) continue;
          const trackedCenterY = rowCenters.get(trackedBranchId);
          if (trackedCenterY !== undefined && hasTreeBranchVerticalTravel(trackedCenterY, activeCenterY, 'up'))
            retreatedIds.add(trackedBranchId);
        }
      }
    } else {
      const retreat = retreatByBranch.current.get(branchId);
      if (retreat) {
        const tracked = trackTreeBranchRetreat(retreat.originY, clientY);
        if (tracked.retreated) retreatedIds.add(branchId);
        else retreat.originY = tracked.originY;
      }
    }

    if (retreatedIds.size > 0) {
      diagnostics?.('tree.pointer.retreated', {
        activeBranchId: branchId,
        phase,
        retreatedBranchIds: [...retreatedIds].join('|'),
        retreatedCount: retreatedIds.size,
      });
      clearGestureMany(retreatedIds);
    }
    return retreatedIds.has(branchId);
  }

  function trackPointer(branchId: string, clientY: number): boolean {
    return samplePointer(branchId, clientY, 'move');
  }

  useLayoutEffect(() => {
    diagnostics?.('tree.expansion.committed', {
      gestureCount: gestureIds.size,
      openCount: openIds.size,
      openIds: [...openIds].join('|'),
      persistentCount: persistentIds.size,
    });
  }, [diagnostics, gestureIds, openIds, persistentIds]);

  return {
    beginPointerTrack,
    collapse,
    expandFromGesture,
    isOpen: (branchId: string) => openIds.has(branchId),
    openIds,
    setPersistent,
    togglePersistent,
    trackPointer,
  };
}
