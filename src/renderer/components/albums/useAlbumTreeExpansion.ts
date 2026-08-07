import { useRef, useState, type RefObject } from 'react';
import { hasAlbumTreeVerticalTravel, trackAlbumTreeRetreat } from '@/renderer/components/albums/albumTreeInteraction';

const branchRevealDelayMs = 340;
const viewportInset = 8;

interface RetreatOrigin {
  originY: number;
}

function getAlbumRowCenters(viewport: HTMLDivElement | null) {
  const centers = new Map<string, number>();
  if (!viewport) return centers;
  for (const row of viewport.querySelectorAll<HTMLElement>('[data-album-id]')) {
    const albumId = row.dataset.albumId;
    if (!albumId) continue;
    const rect = row.getBoundingClientRect();
    centers.set(albumId, rect.top + rect.height / 2);
  }
  return centers;
}

function revealBranch(viewport: HTMLDivElement | null, albumId: string) {
  if (!viewport) return;
  window.setTimeout(() => {
    const branch = [...viewport.querySelectorAll<HTMLElement>('[data-album-branch-id]')].find(
      (element) => element.dataset.albumBranchId === albumId,
    );
    if (!branch) return;
    const row = [...branch.querySelectorAll<HTMLElement>('[data-album-id]')].find(
      (element) => element.dataset.albumId === albumId,
    );
    if (!row) return;

    const viewportRect = viewport.getBoundingClientRect();
    const branchRect = branch.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const overflow = branchRect.bottom - viewportRect.bottom + viewportInset;
    const availableShift = rowRect.top - viewportRect.top - viewportInset;
    const shift = Math.min(overflow, availableShift);
    if (shift <= 0) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    viewport.scrollBy({ top: shift, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, branchRevealDelayMs);
}

/**
 * Keeps deliberate expansion separate from gesture expansion. A branch
 * opened by pulling downward stays latched open until the pointer slides
 * upward across its cover. Pointer leave, clicks, and movement in the child
 * list deliberately do not release that latch.
 */
export function useAlbumTreeExpansion(viewportRef: RefObject<HTMLDivElement | null>) {
  const [persistentIds, setPersistentIds] = useState<Set<string>>(() => new Set());
  const [hoverIds, setHoverIds] = useState<Set<string>>(() => new Set());
  const persistentIdsRef = useRef(persistentIds);
  const hoverIdsRef = useRef(hoverIds);
  const pointerYByAlbum = useRef(new Map<string, number>());
  const retreatByAlbum = useRef(new Map<string, RetreatOrigin>());

  function updatePersistent(updater: (current: Set<string>) => Set<string>) {
    setPersistentIds((current) => {
      const next = updater(current);
      persistentIdsRef.current = next;
      return next;
    });
  }

  function clearHoverMany(albumIds: ReadonlySet<string>) {
    for (const albumId of albumIds) retreatByAlbum.current.delete(albumId);
    if (![...albumIds].some((albumId) => hoverIdsRef.current.has(albumId))) return;
    const next = new Set(hoverIdsRef.current);
    for (const albumId of albumIds) next.delete(albumId);
    hoverIdsRef.current = next;
    setHoverIds(next);
  }

  function collapse(albumId: string) {
    // A pull-down-opened branch is owned by its gesture until upward retreat.
    if (hoverIdsRef.current.has(albumId)) return;
    updatePersistent((current) => {
      if (!current.has(albumId)) return current;
      const next = new Set(current);
      next.delete(albumId);
      return next;
    });
  }

  function setPersistent(albumId: string, open: boolean) {
    // Radix disclosure changes and row clicks must not release a gesture latch.
    if (hoverIdsRef.current.has(albumId)) return;
    if (!open) {
      collapse(albumId);
      return;
    }
    updatePersistent((current) => {
      if (current.has(albumId)) return current;
      const next = new Set(current);
      next.add(albumId);
      return next;
    });
    revealBranch(viewportRef.current, albumId);
  }

  function togglePersistent(albumId: string) {
    setPersistent(albumId, !persistentIdsRef.current.has(albumId));
  }

  function setHover(albumId: string, open: boolean) {
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
    revealBranch(viewportRef.current, albumId);
  }

  function beginPointerTrack(albumId: string, clientY: number) {
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
      const rowCenters = getAlbumRowCenters(viewportRef.current);
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

    if (retreatedIds.size > 0) clearHoverMany(retreatedIds);
    return retreatedIds.has(albumId);
  }

  function trackPointer(albumId: string, clientY: number): boolean {
    return samplePointer(albumId, clientY, 'move');
  }

  return {
    beginPointerTrack,
    collapse,
    isOpen: (albumId: string) => persistentIds.has(albumId) || hoverIds.has(albumId),
    setHover,
    setPersistent,
    togglePersistent,
    trackPointer,
  };
}
