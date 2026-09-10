import type { Point, Rectangle } from 'electron';
import {
  PETAL_DRAWER,
  PETAL_DRAWER_COLUMN,
  petalDrawerHeight,
  petalDrawerWidth,
  type PetalDrawerPosition,
} from '@/shared/contracts/petal-drawer';

export const clampDrawer = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));
export const containsDrawerRect = (bounds: Rectangle, point: Point) =>
  point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;

export function drawerHandle(area: Rectangle, position: PetalDrawerPosition): Rectangle {
  const width = Math.min(PETAL_DRAWER.handle, area.width),
    height = Math.min(PETAL_DRAWER.handleHeight, area.height);
  return {
    x: Math.round(area.x + (area.width - width) * position.xRatio),
    y: Math.round(area.y + (area.height - height) * position.yRatio),
    width,
    height,
  };
}
export function drawerPosition(area: Rectangle, displayId: string, point: Point): PetalDrawerPosition {
  return {
    displayId,
    xRatio: clampDrawer((point.x - area.x) / Math.max(1, area.width - PETAL_DRAWER.handle), 0, 1),
    yRatio: clampDrawer((point.y - area.y) / Math.max(1, area.height - PETAL_DRAWER.handleHeight), 0, 1),
  };
}
export function floatingDrawer(area: Rectangle, position: PetalDrawerPosition, count: number) {
  const handle = drawerHandle(area, position);
  const right = area.x + area.width - handle.x - handle.width;
  const left = handle.x - area.x;
  const edge = right >= left ? ('right' as const) : ('left' as const);
  const available = Math.max(right, left) - PETAL_DRAWER.separation;
  const columns = Math.max(
    1,
    Math.min(
      PETAL_DRAWER.columns,
      Math.max(1, count),
      Math.floor((available - PETAL_DRAWER.padding * 2 - 2 + PETAL_DRAWER.gap) / PETAL_DRAWER_COLUMN),
    ),
  );
  const contentWidth = Math.min(
    Math.max(0, available),
    petalDrawerWidth(columns) - PETAL_DRAWER.handle - PETAL_DRAWER.separation,
  );
  const height = Math.min(area.height, petalDrawerHeight(1));
  const content = {
    x:
      edge === 'right'
        ? handle.x + handle.width + PETAL_DRAWER.separation
        : handle.x - PETAL_DRAWER.separation - contentWidth,
    y: Math.round(clampDrawer(handle.y + (handle.height - height) / 2, area.y, area.y + area.height - height)),
    width: contentWidth,
    height,
  };
  return { handle, content, edge, columns };
}
export function unionDrawer(a: Rectangle, b: Rectangle): Rectangle {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
