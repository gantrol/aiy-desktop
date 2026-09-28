import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { GalleryBrowseState } from '@/shared/contracts/workspace-layout';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type ViewportSnapshot = NonNullable<GalleryBrowseState['viewport']>;

interface Options {
  restoreKey: string;
  resume: ViewportSnapshot | undefined;
  snapshotRef: RefObject<ViewportSnapshot | undefined>;
  viewportRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  visible: boolean;
  ready: boolean;
  imageCount: number;
  hasMore: boolean;
  loadMore(): Promise<void>;
  onChange(viewport: ViewportSnapshot): void;
}

/** Restore only the active browsing session, using the existing paginated reader. */
export function useGalleryViewport({
  restoreKey,
  resume,
  snapshotRef,
  viewportRef,
  active,
  visible,
  ready,
  imageCount,
  hasMore,
  loadMore,
  onChange,
}: Options) {
  const restoration = useRef({ key: restoreKey, pending: true });
  const persist = useStableCallback(onChange);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!active || !visible || !viewport) return;
    const cancel = () => {
      if (!restoration.current.pending) return;
      restoration.current.pending = false;
      const next = { top: viewport.scrollTop, imageCount };
      snapshotRef.current = next;
      persist(next);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key))
        cancel();
    };
    viewport.addEventListener('wheel', cancel, { passive: true });
    viewport.addEventListener('touchstart', cancel, { passive: true });
    viewport.addEventListener('keydown', onKeyDown);
    return () => {
      viewport.removeEventListener('wheel', cancel);
      viewport.removeEventListener('touchstart', cancel);
      viewport.removeEventListener('keydown', onKeyDown);
    };
  }, [active, imageCount, persist, snapshotRef, viewportRef, visible]);

  useLayoutEffect(() => {
    if (restoration.current.key !== restoreKey) restoration.current = { key: restoreKey, pending: true };
    if (!active || !ready) return;
    if (restoration.current.pending && resume && imageCount < resume.imageCount && hasMore) {
      void loadMore();
      return;
    }
    const viewport = viewportRef.current;
    if (!visible || !viewport) return;
    let frame: number | null = null;
    let cancelled = false;
    const capture = () => {
      if (restoration.current.pending || !viewport.getClientRects().length) return;
      const next = { top: viewport.scrollTop, imageCount };
      const previous = snapshotRef.current;
      snapshotRef.current = next;
      if (previous?.top !== next.top || previous.imageCount !== next.imageCount) persist(next);
    };
    const onScroll = () => {
      if (restoration.current.pending) return;
      // Capture immediately so a click before the next paint retains this position.
      snapshotRef.current = { top: viewport.scrollTop, imageCount };
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!cancelled && snapshotRef.current) persist(snapshotRef.current);
      });
    };
    if (restoration.current.pending) {
      // Masonry measures on mount and commits its height before these two paints.
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!restoration.current.pending) return;
        viewport.scrollTop = resume?.top ?? 0;
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (!restoration.current.pending) return;
          viewport.scrollTop = resume?.top ?? 0;
          restoration.current.pending = false;
          capture();
        });
      });
    } else capture();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelled = true;
      viewport.removeEventListener('scroll', onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [active, hasMore, imageCount, loadMore, persist, ready, restoreKey, resume, snapshotRef, viewportRef, visible]);
}
