import type { Point, Rectangle } from 'electron';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';
import { flowerDockSize } from '@/shared/flower-geometry';
export type DockEdge = 'left' | 'right' | 'top' | 'bottom';
export function clampPetalBounds(point: Point, size: { width: number; height: number }, area: Rectangle) {
  return {
    x: Math.round(Math.max(area.x, Math.min(point.x, area.x + area.width - size.width))),
    y: Math.round(Math.max(area.y, Math.min(point.y, area.y + area.height - size.height))),
  };
}
export function flowerVisualBounds(bounds: Rectangle, flowerSize: number): Rectangle {
  return {
    x: bounds.x + (bounds.width - flowerSize) / 2,
    y: bounds.y + (bounds.height - flowerSize) / 2,
    width: flowerSize,
    height: flowerSize,
  };
}
export function clampFlowerBounds(bounds: Rectangle, flowerSize: number, area: Rectangle): Point {
  const visual = flowerVisualBounds(bounds, flowerSize);
  const point = clampPetalBounds(visual, visual, area);
  return { x: Math.round(point.x - (visual.x - bounds.x)), y: Math.round(point.y - (visual.y - bounds.y)) };
}
export function nearestDockEdge(bounds: Rectangle, area: Rectangle): DockEdge | null {
  const distances: [DockEdge, number][] = [
    ['left', Math.abs(bounds.x - area.x)],
    ['right', Math.abs(area.x + area.width - bounds.x - bounds.width)],
    ['top', Math.abs(bounds.y - area.y)],
    ['bottom', Math.abs(area.y + area.height - bounds.y - bounds.height)],
  ];
  const closest = distances.sort((a, b) => a[1] - b[1])[0];
  return closest[1] <= 20 ? closest[0] : null;
}
export function dockBounds(origin: Rectangle, area: Rectangle, edge: DockEdge, collapsed: boolean): Rectangle {
  const size = collapsed ? flowerDockSize() : PETAL_WINDOW_SIZES.flower;
  // Use the same integer anchor in both directions; rounding half pixels on
  // every resize otherwise drifts by one pixel when a dimension changes parity.
  const point = {
    x: origin.x + Math.floor(origin.width / 2) - Math.floor(size.width / 2),
    y: origin.y + Math.floor(origin.height / 2) - Math.floor(size.height / 2),
  };
  if (edge === 'left') point.x = area.x;
  if (edge === 'right') point.x = area.x + area.width - size.width;
  if (edge === 'top') point.y = area.y;
  if (edge === 'bottom') point.y = area.y + area.height - size.height;
  return { ...clampPetalBounds(point, size, area), ...size };
}
