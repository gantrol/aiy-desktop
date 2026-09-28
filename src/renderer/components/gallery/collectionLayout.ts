import {
  computeShortestColumnMasonry,
  type MasonryLayout,
  type MasonryLayoutItem,
} from '@/renderer/components/ui/shortest-column-masonry';

export interface CollectionLayoutItem extends MasonryLayoutItem {
  textOnly?: boolean;
}

export interface CollectionItemMeasurement {
  width: number;
  height: number;
}

const GAP = 24;
const MIN_COLUMN_WIDTH = 240;

/** An initial estimate only; mounted text uses its actual height, including the selected UI font. */
export function collectionTextItemHeight(excerpt?: string, emphasized = false) {
  return (excerpt ? 216 : 120) + (emphasized ? 48 : 0);
}

/** Collection cards share columns; raw image galleries own their separate row/column preference. */
export function computeCollectionLayout(
  items: readonly CollectionLayoutItem[],
  width: number,
  size: number,
  measurements: ReadonlyMap<string, CollectionItemMeasurement>,
): MasonryLayout {
  const columnSize = Math.max(MIN_COLUMN_WIDTH, (size * 4) / 3);
  const columns = computeShortestColumnMasonry([], width, columnSize, GAP);
  if (columns.columnWidth === 0) return columns;
  return computeShortestColumnMasonry(
    items.map((item) => {
      const measurement = measurements.get(item.id);
      const textHeight =
        measurement && Math.abs(measurement.width - columns.columnWidth) < 0.5
          ? measurement.height
          : (item.height ?? collectionTextItemHeight());
      return {
        ...item,
        height: item.textOnly ? textHeight : columns.columnWidth / item.aspectRatio,
      };
    }),
    width,
    columnSize,
    GAP,
  );
}
