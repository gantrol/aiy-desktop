import { useMemo } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { AssetFileRevealContext } from '@/shared/contracts';
import {
  computeShortestColumnMasonry,
  ShortestColumnMasonry,
  type MasonryLayout,
  type MasonryLayoutItem,
  type MasonryPlacement,
} from '@/renderer/components/ui/shortest-column-masonry';
import { getMaterialCardAspectRatio, MaterialCard } from '@/renderer/components/gallery/MaterialCard';
import type { MaterialLibraryItem, SelectionModifiers } from '@/renderer/components/gallery/materialLibraryTypes';

const DEFAULT_MIN_COLUMN_WIDTH = 220;
const DEFAULT_GAP = 16;

export type MaterialMasonryLayoutItem = MasonryLayoutItem;
export type MaterialMasonryPlacement = MasonryPlacement;
export type MaterialMasonryLayout = MasonryLayout;

export interface MaterialMasonryProps {
  items: readonly MaterialLibraryItem[];
  selectedKey: string | null;
  checkedKeys?: ReadonlySet<string>;
  selectionMode?: boolean;
  selectionAvailable?: boolean;
  onSelect(item: MaterialLibraryItem, modifiers?: SelectionModifiers): void;
  onEnterSelection(item: MaterialLibraryItem): void;
  onToggleSelection(item: MaterialLibraryItem): void;
  onCopyText(text: string): void;
  notify(message: string): void;
  minColumnWidth?: number;
  gap?: number;
  className?: string;
  onDragStart?(event: ReactDragEvent<HTMLElement>, item: MaterialLibraryItem): void;
  revealContext?: AssetFileRevealContext;
  revealContextForItem?(item: MaterialLibraryItem): AssetFileRevealContext | undefined;
}

/** Gallery defaults around the shared shortest-column layout calculation. */
export function computeMaterialMasonryLayout(
  items: readonly MaterialMasonryLayoutItem[],
  containerWidth: number,
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
  gap = DEFAULT_GAP,
): MaterialMasonryLayout {
  return computeShortestColumnMasonry(items, containerWidth, minColumnWidth, gap);
}

export function MaterialMasonry({
  items,
  selectedKey,
  checkedKeys,
  selectionMode = false,
  selectionAvailable = true,
  onSelect,
  onEnterSelection,
  onToggleSelection,
  onCopyText,
  notify,
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
  gap = DEFAULT_GAP,
  className,
  onDragStart,
  revealContext,
  revealContextForItem,
}: MaterialMasonryProps) {
  const layoutItems = useMemo(
    () => items.map((item) => ({ id: item.key, aspectRatio: getMaterialCardAspectRatio(item) })),
    [items],
  );

  return (
    <ShortestColumnMasonry
      items={layoutItems}
      minColumnWidth={minColumnWidth}
      gap={gap}
      className={className}
      renderItem={(_layoutItem, index) => (
        <MaterialCard
          item={items[index]}
          selected={items[index].key === selectedKey}
          checked={checkedKeys?.has(items[index].key) ?? false}
          selectionMode={selectionMode}
          selectionAvailable={selectionAvailable}
          viewMode="GRID"
          onSelect={onSelect}
          onEnterSelection={onEnterSelection}
          onToggleSelection={onToggleSelection}
          onCopyText={onCopyText}
          notify={notify}
          onDragStart={onDragStart}
          revealContext={revealContextForItem?.(items[index]) ?? revealContext}
        />
      )}
    />
  );
}
