import { useCallback, type ReactNode, type RefObject } from 'react';
import { MasonrySurface } from '@/renderer/components/ui/masonry-surface';

const DEFAULT_MIN_COLUMN_WIDTH = 240;
const DEFAULT_GAP = 12;
const DEFAULT_ASPECT_RATIO = 4 / 3;

export interface MasonryLayoutItem {
  id: string;
  aspectRatio: number;
  /** Keeps selected rows uniform while aspectRatio remains the responsive fallback. */
  height?: number;
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
  virtualize?: boolean;
  viewportRef?: RefObject<HTMLElement | null>;
  virtualOverscan?: number;
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
    const proportionalHeight = columnWidth / aspectRatio;
    const height =
      item.height === undefined ? proportionalHeight : validPositiveNumber(item.height, proportionalHeight);
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
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
  gap = DEFAULT_GAP,
  sectionBreak,
  ...props
}: ShortestColumnMasonryProps) {
  const sectionBreakIndex = sectionBreak?.index;
  const sectionBreakGap = sectionBreak?.gap;
  const computeLayout = useCallback(
    (width: number) =>
      computeShortestColumnMasonry(
        items,
        width,
        minColumnWidth,
        gap,
        sectionBreakIndex === undefined || sectionBreakGap === undefined
          ? undefined
          : { index: sectionBreakIndex, gap: sectionBreakGap },
      ),
    [items, minColumnWidth, gap, sectionBreakIndex, sectionBreakGap],
  );
  return <MasonrySurface items={items} computeLayout={computeLayout} {...props} />;
}
