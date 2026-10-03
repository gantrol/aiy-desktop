import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { TreeBranchDiagnosticSink } from '@/renderer/components/albums/useTreeBranchExpansion';

const viewportInset = 8;
let nextRevealSequence = 0;

interface RevealRequest {
  cancel?: () => void;
}

function canRevealBranch(viewport: HTMLDivElement, branch: HTMLElement) {
  return (
    viewport.isConnected &&
    viewport.contains(branch) &&
    !branch.closest('[data-tree-branch-id][data-state="closed"], [hidden]')
  );
}

function scrollBranch(
  viewport: HTMLDivElement,
  branch: HTMLElement,
  branchId: string,
  revealSequence: number,
  diagnostics?: TreeBranchDiagnosticSink,
) {
  if (!canRevealBranch(viewport, branch)) {
    diagnostics?.('tree.reveal.skipped', { branchId, reason: 'branch-no-longer-visible', revealSequence });
    return;
  }
  const row = branch.querySelector<HTMLElement>(':scope > [data-tree-node-id]');
  if (!row) {
    diagnostics?.('tree.reveal.skipped', { branchId, reason: 'missing-row', revealSequence });
    return;
  }

  const measuredAt = diagnostics ? performance.now() : 0;
  const viewportRect = viewport.getBoundingClientRect();
  const branchRect = branch.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const overflow = branchRect.bottom - viewportRect.bottom + viewportInset;
  const availableShift = rowRect.top - viewportRect.top - viewportInset;
  const shift = Math.min(overflow, availableShift);
  diagnostics?.('tree.reveal.geometry', {
    branchId,
    availableShiftPx: availableShift,
    durationMs: performance.now() - measuredAt,
    overflowPx: overflow,
    revealSequence,
    shiftPx: shift,
  });
  if (shift <= 0) {
    diagnostics?.('tree.reveal.skipped', { branchId, reason: 'already-visible', revealSequence });
    return;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  diagnostics?.('tree.reveal.scroll-started', {
    branchId,
    behavior: reduceMotion ? 'auto' : 'smooth',
    revealSequence,
    shiftPx: shift,
  });
  viewport.scrollBy({ top: shift, behavior: reduceMotion ? 'auto' : 'smooth' });
}

function branchLayoutAnimations(viewport: HTMLDivElement, branch: HTMLElement) {
  const animations: Animation[] = [];
  let content = branch.querySelector<HTMLElement>(':scope > .tree-branch-content');
  while (content && viewport.contains(content)) {
    // Only branch-height animations affect this measurement. Cover previews and
    // descendant decorations must not postpone navigation.
    animations.push(...content.getAnimations());
    content = content.parentElement?.closest<HTMLElement>('.tree-branch-content') ?? null;
  }
  return animations;
}

/** Reveal requests belong to this tree instance and the committed open state. */
export function useTreeBranchReveal(
  viewportRef: RefObject<HTMLDivElement | null>,
  openIds: ReadonlySet<string>,
  diagnostics?: TreeBranchDiagnosticSink,
) {
  const requestsRef = useRef(new Map<string, RevealRequest>());
  const requestReveal = useCallback((branchId: string) => {
    const requests = requestsRef.current;
    requests.get(branchId)?.cancel?.();
    requests.set(branchId, {});
  }, []);

  useLayoutEffect(() => {
    const requests = requestsRef.current;
    for (const [branchId, request] of requests) {
      const viewport = viewportRef.current;
      const branch =
        viewport &&
        [...viewport.querySelectorAll<HTMLElement>('[data-tree-branch-id]')].find(
          (element) => element.dataset.treeBranchId === branchId,
        );
      if (!openIds.has(branchId) || !viewport || !branch || !canRevealBranch(viewport, branch)) {
        request.cancel?.();
        requests.delete(branchId);
        diagnostics?.('tree.reveal.skipped', { branchId, reason: 'branch-no-longer-visible' });
        continue;
      }
      if (request.cancel) continue;

      let cancelled = false;
      request.cancel = () => {
        cancelled = true;
      };
      const revealSequence = diagnostics ? ++nextRevealSequence : 0;
      const animations = branchLayoutAnimations(viewport, branch);
      diagnostics?.('tree.reveal.scheduled', { branchId, animationCount: animations.length, revealSequence });
      // A cancelled animation can mean reduced motion was enabled. Recheck the
      // live branch before scrolling; closing/unmounting cancels the request.
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (cancelled) return;
        requests.delete(branchId);
        if (viewportRef.current !== viewport) return;
        scrollBranch(viewport, branch, branchId, revealSequence, diagnostics);
      });
    }
  }, [diagnostics, openIds, viewportRef]);

  useLayoutEffect(() => {
    const requests = requestsRef.current;
    return () => {
      for (const request of requests.values()) request.cancel?.();
      requests.clear();
    };
  }, []);

  return requestReveal;
}
