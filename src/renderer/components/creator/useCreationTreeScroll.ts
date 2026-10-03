import { useLayoutEffect, useRef, type RefObject } from 'react';
import { creationLibraryStickyInset } from '@/renderer/components/creator/CreationLibraryStickyPath';

export function creationTreeNavigationKey(currentKey: string | null, ancestors: readonly string[]) {
  return currentKey ? JSON.stringify([...ancestors, currentKey]) : null;
}

export function useCreationTreeScrollMemory() {
  return useRef<{ top: number; navigationKey: string | null }>({ top: 0, navigationKey: null });
}

interface Options {
  active: boolean;
  viewportRef?: RefObject<HTMLDivElement | null>;
  memory: ReturnType<typeof useCreationTreeScrollMemory>;
  navigationKey: string | null;
  currentSelector: string;
}

export function afterBranchExpansion(viewport: HTMLDivElement, callback: () => void) {
  let cancelled = false;
  const frame = requestAnimationFrame(() => {
    const expansions = viewport
      .getAnimations({ subtree: true })
      .filter((animation) => animation instanceof CSSAnimation && animation.animationName === 'tree-branch-expand');
    const finish = () => {
      if (!cancelled) callback();
    };
    if (expansions.length) void Promise.allSettled(expansions.map((animation) => animation.finished)).then(finish);
    else finish();
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

/** Preserve each view's scroll, revealing current work only when navigation changes. */
export function useCreationTreeScroll({
  active,
  viewportRef: sharedViewportRef,
  memory,
  navigationKey,
  currentSelector,
}: Options) {
  const localViewportRef = useRef<HTMLDivElement>(null);
  const viewportRef = sharedViewportRef ?? localViewportRef;
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!active || !viewport) return;
    const top = memory.current.top;
    let restoring = true;
    const cancelRestore = afterBranchExpansion(viewport, () => {
      viewport.scrollTop = top;
      restoring = false;
      memory.current.top = viewport.scrollTop;
    });
    const remember = () => {
      if (!restoring) memory.current.top = viewport.scrollTop;
    };
    const interruptRestore = () => {
      cancelRestore();
      restoring = false;
    };
    viewport.addEventListener('scroll', remember);
    viewport.addEventListener('wheel', interruptRestore, { passive: true });
    viewport.addEventListener('pointerdown', interruptRestore);
    viewport.addEventListener('keydown', interruptRestore);
    return () => {
      cancelRestore();
      if (viewport.getClientRects().length) remember();
      viewport.removeEventListener('scroll', remember);
      viewport.removeEventListener('wheel', interruptRestore);
      viewport.removeEventListener('pointerdown', interruptRestore);
      viewport.removeEventListener('keydown', interruptRestore);
    };
  }, [active, memory, viewportRef]);

  // Rows may arrive or expand after navigation; retry until the current row is mounted.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!active || !viewport || memory.current.navigationKey === navigationKey) return;
    if (!navigationKey) {
      memory.current.navigationKey = null;
      return;
    }
    return afterBranchExpansion(viewport, () => {
      const current = viewport.querySelector<HTMLElement>(currentSelector);
      if (!current || !current.getClientRects().length) return;
      const bounds = viewport.getBoundingClientRect();
      const row = current.getBoundingClientRect();
      const visibleTop = bounds.top + creationLibraryStickyInset(viewport, current);
      if (row.top < visibleTop) viewport.scrollTop += row.top - visibleTop;
      else if (row.bottom > bounds.bottom) viewport.scrollTop += row.bottom - bounds.bottom;
      memory.current.navigationKey = navigationKey;
      memory.current.top = viewport.scrollTop;
    });
  });
  return viewportRef;
}
