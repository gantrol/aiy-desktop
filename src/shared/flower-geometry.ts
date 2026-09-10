import {
  ROSE_LAYERS,
  roseLayerOutline,
  roseLayerPose,
  type RoseOutline,
  type RosePoint,
} from '@/shared/rose-petal-design';

export { ROSE_CENTER, ROSE_OUTER_COUNT, flowerFoldPose } from '@/shared/rose-petal-design';

export type FlowerPoint = RosePoint;
export type FlowerEdge = 'left' | 'right' | 'top' | 'bottom';
type Point = { x: number; y: number };
export type FlowerBounds = Point & { width: number; height: number };
export const FLOWER_MOTION = { close: 320, open: 420, hover: 200, leave: 600 } as const;
export const FLOWER_PETAL_COUNT = ROSE_LAYERS.length;
export const FLOWER_CENTER_LAYER = ROSE_LAYERS.findIndex((layer) => layer.kind === 'center');
export const isPluckableFlowerPetal = (index: number) => ROSE_LAYERS[index]?.kind === 'outer';

function pathFor(shape: RoseOutline) {
  const values = (numbers: readonly number[]) => numbers.map((n) => Number(n.toFixed(3))).join(' ');
  return `M${values(shape.start)}${shape.curves.map((c) => `C${values(c)}`).join('')}Z`;
}
function boundsFor(points: readonly RosePoint[]): FlowerBounds {
  const x = Math.min(...points.map((p) => p[0])),
    y = Math.min(...points.map((p) => p[1]));
  return { x, y, width: Math.max(...points.map((p) => p[0])) - x, height: Math.max(...points.map((p) => p[1])) - y };
}
function flatten(shape: RoseOutline): RosePoint[] {
  let previous = shape.start;
  return shape.curves.flatMap((curve) => {
    const start = previous;
    previous = [curve[4], curve[5]];
    return Array.from({ length: 24 }, (_, i): RosePoint => {
      const t = i / 24,
        s = 1 - t;
      return [
        s ** 3 * start[0] + 3 * s ** 2 * t * curve[0] + 3 * s * t ** 2 * curve[2] + t ** 3 * curve[4],
        s ** 3 * start[1] + 3 * s ** 2 * t * curve[1] + 3 * s * t ** 2 * curve[3] + t ** 3 * curve[5],
      ];
    });
  });
}
const openShapes = ROSE_LAYERS.map((layer) => roseLayerOutline(layer, 0));
const closedShapes = ROSE_LAYERS.map((layer) => roseLayerOutline(layer, 1));
const openOutlines = openShapes.map(flatten);
const closedOutlines = closedShapes.map(flatten);
const openPaths = openShapes.map(pathFor);
const closedPaths = closedShapes.map(pathFor);
const openRims = ROSE_LAYERS.map((layer) => (layer.rim ? pathFor(roseLayerOutline(layer, 0, 'rim')) : ''));
const closedRims = ROSE_LAYERS.map((layer) => (layer.rim ? pathFor(roseLayerOutline(layer, 1, 'rim')) : ''));

/** Rendering and native hit regions derive from the same templates; endpoints are cached. */
export function flowerPetalGeometry(index: number, fold: number) {
  const layer = ROSE_LAYERS[index];
  const pose = roseLayerPose(layer, fold);
  return {
    kind: layer.kind,
    body: fold <= 0 ? openPaths[index] : fold >= 1 ? closedPaths[index] : pathFor(roseLayerOutline(layer, fold)),
    rim: !layer.rim
      ? ''
      : fold <= 0
        ? openRims[index]
        : fold >= 1
          ? closedRims[index]
          : pathFor(roseLayerOutline(layer, fold, 'rim')),
    paintTransform: `translate(100 100) rotate(${pose.angle}) scale(${pose.width} ${pose.height}) translate(-100 -100)`,
  };
}

export const ROSE_BUD_BOUNDS = boundsFor(closedOutlines.flat());
export const ROSE_BUD_SCALE = 56 / Math.max(ROSE_BUD_BOUNDS.width, ROSE_BUD_BOUNDS.height);
export const ROSE_BUD_SIZE = 200 * ROSE_BUD_SCALE;
export const roseBudCenter = {
  x: ROSE_BUD_BOUNDS.x + ROSE_BUD_BOUNDS.width / 2,
  y: ROSE_BUD_BOUNDS.y + ROSE_BUD_BOUNDS.height / 2,
};
// A top-view bud retains its orientation at every edge.
export const flowerDockSize = () => ({
  width: Math.ceil(ROSE_BUD_BOUNDS.width * ROSE_BUD_SCALE) + 8,
  height: Math.ceil(ROSE_BUD_BOUNDS.height * ROSE_BUD_SCALE) + 8,
});
function contains(outline: readonly RosePoint[], point: Point) {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const a = outline[previous],
      b = outline[index];
    if (a[1] > point.y !== b[1] > point.y && point.x < ((b[0] - a[0]) * (point.y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}
/** Return/drop accepts the entire painted flower, including its center. */
export function containsFlowerPoint(point: Point, anchor: Point, size: number) {
  const local = { x: ((point.x - anchor.x) * 200) / size + 100, y: ((point.y - anchor.y) * 200) / size + 100 };
  return openOutlines.some((outline) => contains(outline, local));
}
export function containsDockedPetalPoint(point: Point, bounds: FlowerBounds) {
  const local = {
    x: (point.x - bounds.x - bounds.width / 2) / ROSE_BUD_SCALE + roseBudCenter.x,
    y: (point.y - bounds.y - bounds.height / 2) / ROSE_BUD_SCALE + roseBudCenter.y,
  };
  return closedOutlines.some((outline) => contains(outline, local));
}
export function flowerPetalAnchor(index: number): RosePoint {
  return ROSE_LAYERS[index].anchor;
}
