import { computeJustifiedRows } from '@/renderer/components/ui/justified-row-layout';
import {
  computeShortestColumnMasonry,
  type MasonryLayout,
  type MasonryLayoutItem,
} from '@/renderer/components/ui/shortest-column-masonry';
import type { MaterialLayoutPreferences } from '@/renderer/components/gallery/materialLayoutPreferences';

export const MATERIAL_NAME_HEIGHT = 28;
export const MATERIAL_ROW_GAP = 8;
export const MIN_MATERIAL_FRAME_RATIO = 1 / 3;
export const MAX_MATERIAL_FRAME_RATIO = 3;

export function materialFrameRatio(ratio: number) {
  return Math.max(MIN_MATERIAL_FRAME_RATIO, Math.min(MAX_MATERIAL_FRAME_RATIO, ratio));
}

export interface MaterialLayoutItem extends MasonryLayoutItem {
  text: boolean;
}

/** Text runs keep readable column cards without moving them past adjacent images. */
export function computeMaterialLayout(
  items: readonly MaterialLayoutItem[],
  width: number,
  preferences: MaterialLayoutPreferences,
  minColumnWidth = preferences.size,
  gap = MATERIAL_ROW_GAP,
): MasonryLayout {
  const captionHeight = preferences.showNames ? MATERIAL_NAME_HEIGHT : 0;
  if (preferences.arrangement === 'COLUMNS') {
    const base = computeShortestColumnMasonry([], width, minColumnWidth, gap);
    return computeShortestColumnMasonry(
      items.map((item) => ({
        ...item,
        height: base.columnWidth / item.aspectRatio + (item.text ? 0 : captionHeight),
      })),
      width,
      minColumnWidth,
      gap,
    );
  }

  const layout: MasonryLayout = { columnCount: 0, columnWidth: 0, height: 0, placements: [] };
  let start = 0;
  while (start < items.length) {
    const text = items[start].text;
    let end = start + 1;
    while (end < items.length && items[end].text === text) end += 1;
    const run = items.slice(start, end);
    const section = text
      ? computeShortestColumnMasonry(run, width, minColumnWidth, gap)
      : computeJustifiedRows(run, width, preferences.size, gap, captionHeight);
    const offset = layout.placements.length ? layout.height + gap : 0;
    for (const placement of section.placements) {
      layout.placements.push({ ...placement, index: placement.index + start, y: placement.y + offset });
    }
    layout.height = offset + section.height;
    start = end;
  }
  return layout;
}
