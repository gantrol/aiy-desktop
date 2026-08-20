import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';

const DEFAULT_MIN_COLUMN_WIDTH = 240;
const DEFAULT_GAP = 12;
const DEFAULT_ASPECT_RATIO = 4 / 3;

export interface MasonryLayoutItem {
  id: string;
  aspectRatio: number;
}

export interface MasonryPlacement {
  id: string;
  index: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MasonryLayout {
  columnCount: number;
  columnWidth: number;
  height: number;
  placements: MasonryPlacement[];
}

export interface MasonrySectionBreak {
  index: number;
  gap: number;
}

export interface ShortestColumnMasonryProps {
  items: readonly MasonryLayoutItem[];
  renderItem(
    item: MasonryLayoutItem,
    index: number,
    placement: Readonly<MasonryPlacement>,
    layout: Readonly<MasonryLayout>,
  ): ReactNode;
  minColumnWidth?: number;
  gap?: number;
  className?: string;
  sectionBreak?: Readonly<MasonrySectionBreak>;
  onLayoutChange?(layout: MasonryLayout): void;
}

function validPositiveNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Places source-ordered items one at a time in the currently shortest column.
 * The returned coordinates are deterministic, so visual packing does not need
 * to reorder the DOM or wait for image measurement.
 */
export function computeShortestColumnMasonry(
  items: readonly MasonryLayoutItem[],
  containerWidth: number,
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
  gap = DEFAULT_GAP,
  sectionBreak?: Readonly<MasonrySectionBreak>,
): MasonryLayout {
  const width = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
  const minimumWidth = validPositiveNumber(minColumnWidth, DEFAULT_MIN_COLUMN_WIDTH);
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : DEFAULT_GAP;
  const columnCount = Math.max(1, Math.floor((width + safeGap) / (minimumWidth + safeGap)));
  const columnWidth = columnCount > 0 ? Math.max(0, (width - safeGap * (columnCount - 1)) / columnCount) : 0;
  const columnHeights = Array.from({ length: columnCount }, () => 0);

  const placements = items.map((item, index) => {
    if (index === sectionBreak?.index) {
      const occupiedHeights = columnHeights.filter((height) => height > 0);
      const fallbackHeight = occupiedHeights.length ? Math.min(...occupiedHeights) : 0;
      const extraGap = Math.max(0, sectionBreak.gap - safeGap);
      for (let column = 0; column < columnHeights.length; column += 1) {
        columnHeights[column] = (columnHeights[column] || fallbackHeight) + extraGap;
      }
    }

    let column = 0;
    for (let candidate = 1; candidate < columnHeights.length; candidate += 1) {
      if (columnHeights[candidate] < columnHeights[column]) column = candidate;
    }

    const aspectRatio = validPositiveNumber(item.aspectRatio, DEFAULT_ASPECT_RATIO);
    const height = columnWidth / aspectRatio;
    const placement: MasonryPlacement = {
      id: item.id,
      index,
      column,
      x: column * (columnWidth + safeGap),
      y: columnHeights[column],
      width: columnWidth,
      height,
    };
    columnHeights[column] += height + safeGap;
    return placement;
  });

  return {
    columnCount,
    columnWidth,
    height: items.length ? Math.max(...columnHeights) - safeGap : 0,
    placements,
  };
}

export function ShortestColumnMasonry({
  items,
  renderItem,
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
  gap = DEFAULT_GAP,
  className,
  sectionBreak,
  onLayoutChange,
}: ShortestColumnMasonryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const measure = () => setContainerWidth(root.getBoundingClientRect().width);
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const sectionBreakIndex = sectionBreak?.index;
  const sectionBreakGap = sectionBreak?.gap;
  const layout = useMemo(
    () =>
      computeShortestColumnMasonry(
        items,
        containerWidth,
        minColumnWidth,
        gap,
        sectionBreakIndex === undefined || sectionBreakGap === undefined
          ? undefined
          : { index: sectionBreakIndex, gap: sectionBreakGap },
      ),
    [containerWidth, gap, items, minColumnWidth, sectionBreakGap, sectionBreakIndex],
  );

  useLayoutEffect(() => onLayoutChange?.(layout), [layout, onLayoutChange]);

  // These cards do not animate between columns. Real offsets keep the browser's
  // image visibility and raster bounds aligned with where each card is painted.
  return (
    <div
      ref={rootRef}
      data-shortest-column-masonry
      data-masonry-columns={layout.columnCount}
      className={cn('relative w-full', !containerWidth && 'invisible', className)}
      style={{ height: layout.height }}
    >
      {layout.placements.map((placement) => (
        <div
          key={placement.id}
          data-masonry-item={placement.id}
          className="absolute"
          style={{
            left: placement.x,
            top: placement.y,
            width: placement.width,
            height: placement.height,
          }}
        >
          {renderItem(items[placement.index], placement.index, placement, layout)}
        </div>
      ))}
    </div>
  );
}
