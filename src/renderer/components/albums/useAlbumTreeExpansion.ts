import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { hasAlbumTreeVerticalTravel, trackAlbumTreeRetreat } from '@/renderer/components/albums/albumTreeInteraction';

const branchRevealDelayMs = 340;
const viewportInset = 8;
let nextRevealSequence = 0;

export type AlbumTreeDiagnosticValue = string | number | boolean | null;
export type AlbumTreeDiagnosticSink = (
  name: string,
  details?: Readonly<Record<string, AlbumTreeDiagnosticValue | undefined>>,
) => void;

interface RetreatOrigin {
  originY: number;
}

function getAlbumRowCenters(
  viewport: HTMLDivElement | null,
  activeAlbumId: string,
  diagnostics?: AlbumTreeDiagnosticSink,
) {
  const centers = new Map<string, number>();
  if (!viewport) {
    diagnostics?.('tree.pointer.geometry', { activeAlbumId, outcome: 'missing-viewport', rowCount: 0 });
    return centers;
  }
  const startedAt = diagnostics ? performance.now() : 0;
  for (const row of viewport.querySelectorAll<HTMLElement>('[data-album-id]')) {
    const albumId = row.dataset.albumId;
    if (!albumId) continue;
    const rect = row.getBoundingClientRect();
    centers.set(albumId, rect.top + rect.height / 2);
  }
  diagnostics?.('tree.pointer.geometry', {
    activeAlbumId,
    durationMs: performance.now() - startedAt,
    outcome: 'measured',
    rowCount: centers.size,
  });
  return centers;
}

function revealBranch(viewport: HTMLDivElement | null, albumId: string, diagnostics?: AlbumTreeDiagnosticSink) {
  if (!viewport) {
    diagnostics?.('tree.reveal.skipped', { albumId, reason: 'missing-viewport' });
    return;
  }
  const revealSequence = diagnostics ? ++nextRevealSequence : 0;
  const scheduledAt = diagnostics ? performance.now() : 0;
  diagnostics?.('tree.reveal.scheduled', {
    albumId,
    delayMs: branchRevealDelayMs,
    revealSequence,
  });
  window.setTimeout(() => {
    diagnostics?.('tree.reveal.timer-fired', {
      albumId,
      actualDelayMs: performance.now() - scheduledAt,
      revealSequence,
    });
    const branch = [...viewport.querySelectorAll<HTMLElement>('[data-album-branch-id]')].find(
      (element) => element.dataset.albumBranchId === albumId,
    );
    if (!branch) {
      diagnostics?.('tree.reveal.skipped', { albumId, reason: 'missing-branch', revealSequence });
      return;
    }
    const row = [...branch.querySelectorAll<HTMLElement>('[data-album-id]')].find(
      (element) => element.dataset.albumId === albumId,
    );
    if (!row) {
      diagnostics?.('tree.reveal.skipped', { albumId, reason: 'missing-row', revealSequence });
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
      albumId,
      availableShiftPx: availableShift,
      durationMs: performance.now() - measuredAt,
      overflowPx: overflow,
      revealSequence,
      shiftPx: shift,
    });
    if (shift <= 0) {
      diagnostics?.('tree.reveal.skipped', { albumId, reason: 'already-visible', revealSequence });
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    diagnostics?.('tree.reveal.scroll-started', {
      albumId,
      behavior: reduceMotion ? 'auto' : 'smooth',
      revealSequence,
      shiftPx: shift,
    });
    viewport.scrollBy({ top: shift, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, branchRevealDelayMs);
}

/**
 * Keeps deliberate expansion separate from gesture expansion. A branch
 * opened by pulling downward stays latched open until the pointer slides
 * upward across its cover. Pointer leave, clicks, and movement in the child
 * list deliberately do not release that latch.
 */
export function useAlbumTreeExpansion(
  viewportRef: RefObject<HTMLDivElement | null>,
  initialPersistentIds: readonly string[] = [],
  diagnostics?: AlbumTreeDiagnosticSink,
) {
  const [persistentIds, setPersistentIds] = useState<Set<string>>(() => new Set(initialPersistentIds));
  const [hoverIds, setHoverIds] = useState<Set<string>>(() => new Set());
  const persistentIdsRef = useRef(persistentIds);
  const hoverIdsRef = useRef(hoverIds);
  const pointerYByAlbum = useRef(new Map<string, number>());
  const retreatByAlbum = useRef(new Map<string, RetreatOrigin>());

  const updatePersistent = useCallback((updater: (current: Set<string>) => Set<string>) => {
    setPersistentIds((current) => {
      const next = updater(current);
      persistentIdsRef.current = next;
      return next;
    });
  }, []);

  function clearHoverMany(albumIds: ReadonlySet<string>) {
    for (const albumId of albumIds) retreatByAlbum.current.delete(albumId);
    if (![...albumIds].some((albumId) => hoverIdsRef.current.has(albumId))) return;
    const next = new Set(hoverIdsRef.current);
    for (const albumId of albumIds) next.delete(albumId);
    hoverIdsRef.current = next;
    setHoverIds(next);
  }

  const collapse = useCallback(
    (albumId: string) => {
      diagnostics?.('tree.expansion.requested', {
        albumId,
        hoverBefore: hoverIdsRef.current.has(albumId),
        persistentBefore: persistentIdsRef.current.has(albumId),
        requestedOpen: false,
      });
      // A pull-down-opened branch is owned by its gesture until upward retreat.
      if (hoverIdsRef.current.has(albumId)) {
        diagnostics?.('tree.expansion.blocked', { albumId, reason: 'gesture-latched', requestedOpen: false });
        return;
      }
      updatePersistent((current) => {
        if (!current.has(albumId)) return current;
        const next = new Set(current);
        next.delete(albumId);
        return next;
      });
    },
    [diagnostics, updatePersistent],
  );

  const setPersistent = useCallback(
    (albumId: string, open: boolean) => {
      if (!open) {
        collapse(albumId);
        return;
      }
      diagnostics?.('tree.expansion.requested', {
        albumId,
        hoverBefore: hoverIdsRef.current.has(albumId),
        persistentBefore: persistentIdsRef.current.has(albumId),
        requestedOpen: true,
      });
      // Radix disclosure changes and row clicks must not release a gesture latch.
      if (hoverIdsRef.current.has(albumId)) {
        diagnostics?.('tree.expansion.blocked', { albumId, reason: 'gesture-latched', requestedOpen: true });
        return;
      }
      if (persistentIdsRef.current.has(albumId)) {
        diagnostics?.('tree.expansion.skipped', { albumId, reason: 'already-open', requestedOpen: true });
        return;
      }
      updatePersistent((current) => {
        if (current.has(albumId)) return current;
        const next = new Set(current);
        next.add(albumId);
        return next;
      });
      revealBranch(viewportRef.current, albumId, diagnostics);
    },
    [collapse, diagnostics, updatePersistent, viewportRef],
  );

  const togglePersistent = useCallback(
    (albumId: string) => {
      setPersistent(albumId, !persistentIdsRef.current.has(albumId));
    },
    [setPersistent],
  );

  function setHover(albumId: string, open: boolean) {
    diagnostics?.('tree.hover.requested', {
      albumId,
      hoverBefore: hoverIdsRef.current.has(albumId),
      persistentBefore: persistentIdsRef.current.has(albumId),
      requestedOpen: open,
    });
    // Gesture-open state may only be cleared by samplePointer's upward retreat.
    if (!open) return;
    if (persistentIdsRef.current.has(albumId)) return;
    const originY = pointerYByAlbum.current.get(albumId);
    if (originY !== undefined) {
      retreatByAlbum.current.set(albumId, {
        originY,
      });
    }
    if (hoverIdsRef.current.has(albumId)) return;
    const next = new Set(hoverIdsRef.current);
    next.add(albumId);
    hoverIdsRef.current = next;
    setHoverIds(next);
    revealBranch(viewportRef.current, albumId, diagnostics);
  }

  function beginPointerTrack(albumId: string, clientY: number) {
    diagnostics?.('tree.pointer.entered', { albumId, clientY });
    samplePointer(albumId, clientY, 'enter');
  }

  function samplePointer(albumId: string, clientY: number, phase: 'enter' | 'move'): boolean {
    pointerYByAlbum.current.set(albumId, clientY);
    const retreatedIds = new Set<string>();

    if (phase === 'enter') {
      const currentRetreat = retreatByAlbum.current.get(albumId);
      if (currentRetreat) {
        const tracked = trackAlbumTreeRetreat(currentRetreat.originY, clientY);
        if (tracked.retreated) retreatedIds.add(albumId);
        else currentRetreat.originY = clientY;
      }

      // A jump between covers is judged by their current visual order, not by
      // another album's pointer baseline. This survives viewport auto-scroll
      // and prevents movement on a lower child from folding its parent.
      const rowCenters = getAlbumRowCenters(viewportRef.current, albumId, diagnostics);
      const activeCenterY = rowCenters.get(albumId);
      if (activeCenterY !== undefined) {
        for (const trackedAlbumId of retreatByAlbum.current.keys()) {
          if (trackedAlbumId === albumId) continue;
          const trackedCenterY = rowCenters.get(trackedAlbumId);
          if (trackedCenterY !== undefined && hasAlbumTreeVerticalTravel(trackedCenterY, activeCenterY, 'up'))
            retreatedIds.add(trackedAlbumId);
        }
      }
    } else {
      const retreat = retreatByAlbum.current.get(albumId);
      if (retreat) {
        const tracked = trackAlbumTreeRetreat(retreat.originY, clientY);
        if (tracked.retreated) retreatedIds.add(albumId);
        else retreat.originY = tracked.originY;
      }
    }

    if (retreatedIds.size > 0) {
      diagnostics?.('tree.pointer.retreated', {
        activeAlbumId: albumId,
        phase,
        retreatedAlbumIds: [...retreatedIds].join('|'),
        retreatedCount: retreatedIds.size,
      });
      clearHoverMany(retreatedIds);
    }
    return retreatedIds.has(albumId);
  }

  function trackPointer(albumId: string, clientY: number): boolean {
    return samplePointer(albumId, clientY, 'move');
  }

  const openIds = useMemo(() => new Set([...persistentIds, ...hoverIds]), [hoverIds, persistentIds]);

  useLayoutEffect(() => {
    diagnostics?.('tree.expansion.committed', {
      hoverCount: hoverIds.size,
      openCount: openIds.size,
      openIds: [...openIds].join('|'),
      persistentCount: persistentIds.size,
    });
  }, [diagnostics, hoverIds, openIds, persistentIds]);

  return {
    beginPointerTrack,
    collapse,
    isOpen: (albumId: string) => openIds.has(albumId),
    openIds,
    setHover,
    setPersistent,
    togglePersistent,
    trackPointer,
  };
}
