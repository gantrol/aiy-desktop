import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/renderer/lib/utils';
import type { MasonryLayout, ShortestColumnMasonryProps } from '@/renderer/components/ui/shortest-column-masonry';

interface Props extends Omit<ShortestColumnMasonryProps, 'minColumnWidth' | 'gap' | 'sectionBreak'> {
  computeLayout(width: number): MasonryLayout;
  layoutKind?: 'ROWS' | 'COLUMNS';
  preserveScrollAnchor?: boolean;
}

interface RenderWindow {
  start: number;
  end: number;
}

/** Shared measurement, viewport culling and source-ordered DOM for both arrangements. */
export function MasonrySurface({
  items,
  renderItem,
  computeLayout,
  layoutKind = 'COLUMNS',
  className,
  onLayoutChange,
  virtualize = false,
  viewportRef,
  virtualOverscan = 800,
  preserveScrollAnchor = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const previousLayoutRef = useRef<MasonryLayout | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [renderWindow, setRenderWindow] = useState<RenderWindow | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusReleaseFrameRef = useRef<number | null>(null);

  useLayoutEffect(
    () => () => {
      if (focusReleaseFrameRef.current !== null) window.cancelAnimationFrame(focusReleaseFrameRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    // A detail page can hide this surface with display:none. Keep its geometry
    // until it is visible again instead of collapsing the scrollable height.
    const setWidth = (width: number) => {
      if (width > 0) setContainerWidth(width);
    };
    const measure = () => setWidth(root.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => computeLayout(containerWidth), [computeLayout, containerWidth]);
  useLayoutEffect(() => onLayoutChange?.(layout), [layout, onLayoutChange]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const viewport = viewportRef?.current;
    if (!root || !viewport || (!virtualize && !preserveScrollAnchor)) return undefined;
    const overscan = Math.max(0, virtualOverscan);
    const bucketSize = Math.max(200, overscan / 2);
    let frame: number | null = null;

    const update = () => {
      frame = null;
      if (!root.getClientRects().length || viewport.clientHeight <= 0) {
        previousLayoutRef.current = null;
        return;
      }
      if (preserveScrollAnchor && previousLayoutRef.current !== layout && anchorRef.current) {
        const anchor = anchorRef.current;
        const placement = layout.placements.find((item) => item.id === anchor.id);
        if (placement && layout.height > 0) {
          const offset = root.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
          viewport.scrollTop += offset + placement.y - anchor.offset;
        }
      }
      previousLayoutRef.current = layout;
      const rootRect = root.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const visibleStart = viewportRect.top - rootRect.top;
      const visibleEnd = viewportRect.bottom - rootRect.top;
      if (preserveScrollAnchor) {
        const placement =
          visibleStart >= 0 && visibleStart < layout.height
            ? layout.placements.find((item) => item.y + item.height > visibleStart)
            : undefined;
        anchorRef.current = placement ? { id: placement.id, offset: placement.y - visibleStart } : null;
      }
      if (virtualize) {
        const start = Math.max(0, Math.floor((visibleStart - overscan) / bucketSize) * bucketSize);
        const end = Math.max(start, Math.ceil((visibleEnd + overscan) / bucketSize) * bucketSize);
        setRenderWindow((current) => (current?.start === start && current.end === end ? current : { start, end }));
      }
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [layout, preserveScrollAnchor, viewportRef, virtualize, virtualOverscan]);

  const renderedPlacements = useMemo(() => {
    if (!containerWidth) return [];
    if (!virtualize) return layout.placements;
    const window = renderWindow ?? { start: 0, end: Math.max(2_000, virtualOverscan * 2) };
    const focusedIndex = focusedId === null ? -1 : layout.placements.findIndex((item) => item.id === focusedId);
    return layout.placements.filter(
      (placement, index) =>
        // Keep focus and its neighbours mounted so native Tab can cross a culled boundary.
        (focusedIndex >= 0 && Math.abs(index - focusedIndex) <= 1) ||
        (placement.y + placement.height >= window.start && placement.y <= window.end),
    );
  }, [containerWidth, focusedId, layout.placements, renderWindow, virtualOverscan, virtualize]);

  return (
    <div
      ref={rootRef}
      data-shortest-column-masonry={layoutKind === 'COLUMNS' ? '' : undefined}
      data-justified-row-masonry={layoutKind === 'ROWS' ? '' : undefined}
      data-masonry-columns={layoutKind === 'COLUMNS' ? layout.columnCount : undefined}
      className={cn('relative w-full', !containerWidth && 'invisible', className)}
      style={{ height: layout.height, overflowAnchor: preserveScrollAnchor ? 'none' : undefined }}
      onBlurCapture={() => {
        // A portal is outside this DOM subtree. Let its next React focus event
        // retain the owning item before releasing an offscreen card.
        if (focusReleaseFrameRef.current !== null) window.cancelAnimationFrame(focusReleaseFrameRef.current);
        focusReleaseFrameRef.current = window.requestAnimationFrame(() => {
          focusReleaseFrameRef.current = null;
          setFocusedId(null);
        });
      }}
    >
      {renderedPlacements.map((placement) => (
        <div
          key={placement.id}
          data-masonry-item={placement.id}
          className="absolute"
          style={{ left: placement.x, top: placement.y, width: placement.width, height: placement.height }}
          onFocusCapture={() => {
            // React events from a card's portals still pass through this owner.
            if (focusReleaseFrameRef.current !== null) window.cancelAnimationFrame(focusReleaseFrameRef.current);
            focusReleaseFrameRef.current = null;
            setFocusedId(placement.id);
          }}
        >
          {renderItem(items[placement.index], placement.index, placement, layout)}
        </div>
      ))}
    </div>
  );
}
