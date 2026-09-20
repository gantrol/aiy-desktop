import type { MasonryLayoutItem, MasonryPlacement } from '@/renderer/components/ui/shortest-column-masonry';

export interface JustifiedRowLayout {
  height: number;
  placements: MasonryPlacement[];
}

/**
 * Preserve input order and choose the row break closest to the target height.
 * A short final row stays at the target height instead of stretching to fill.
 * Callers may bound frame ratios; the media itself must still use object-contain.
 */
export function computeJustifiedRows(
  items: readonly MasonryLayoutItem[],
  containerWidth: number,
  targetHeight = 204,
  gap = 8,
  captionHeight = 0,
): JustifiedRowLayout {
  const width = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
  if (!width || !items.length) return { height: 0, placements: [] };
  const target = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : 204;
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 8;
  const caption = Number.isFinite(captionHeight) ? Math.max(0, captionHeight) : 0;
  const ratios = items.map((item) =>
    Number.isFinite(item.aspectRatio) && item.aspectRatio > 0 ? item.aspectRatio : 4 / 3,
  );
  const placements: MasonryPlacement[] = [];
  let start = 0;
  let top = 0;

  while (start < items.length) {
    let end = start;
    let ratioSum = ratios[start];
    let fittedHeight = width / ratioSum;
    while (end + 1 < items.length && fittedHeight > target) {
      const nextSum = ratioSum + ratios[end + 1];
      const nextHeight = (width - spacing * (end + 1 - start)) / nextSum;
      // Avoid subpixel/negative frames in exceptionally narrow containers.
      if (nextHeight <= 0) break;
      if (nextHeight < target && fittedHeight - target < target - nextHeight) break;
      end += 1;
      ratioSum = nextSum;
      fittedHeight = nextHeight;
    }
    const lastRow = end === items.length - 1;
    // Do not enlarge a sparse row into a cover, even before a very wide item.
    const height = Math.min(fittedHeight, lastRow ? target : target * 1.25);
    const justified = height === fittedHeight;
    let left = 0;
    for (let index = start; index <= end; index += 1) {
      const itemWidth = justified && index === end ? Math.max(0, width - left) : ratios[index] * height;
      placements.push({
        id: items[index].id,
        index,
        column: index - start,
        x: left,
        y: top,
        width: itemWidth,
        height: height + caption,
      });
      left += itemWidth + spacing;
    }
    top += height + caption + spacing;
    start = end + 1;
  }
  return { height: top - spacing, placements };
}
