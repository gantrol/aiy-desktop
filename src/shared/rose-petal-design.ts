/** Cubic silhouettes and rolled margins in a petal's local frame on a 200 × 200 canvas. */
export type RosePoint = readonly [number, number];
export type RoseCurve = readonly [number, number, number, number, number, number];
export type RoseOutline = { start: RosePoint; curves: readonly RoseCurve[] };
type RoseKind = 'outer' | 'inner' | 'center';
type RoseContour = { open: RoseOutline; closed: RoseOutline };
type RoseLayer = {
  kind: RoseKind;
  body: RoseContour;
  rim?: RoseContour;
  angle: number;
  width: number;
  height: number;
  closedSize?: number;
  closedAngle?: number;
  anchor: RosePoint;
};

export const ROSE_CENTER = { x: 100, y: 100, radius: 25.5 } as const;
export const ROSE_OUTER_COUNT = 8;
const INNER_COUNT = 5;

// Wide shoulders, an uneven distal edge and a narrow attachment replace the oval petal.
const outer: RoseContour = {
  open: {
    start: [96, 114],
    curves: [
      [77, 110, 52, 91, 46, 69],
      [41, 52, 40, 36, 49, 26],
      [59, 13, 78, 20, 91, 14],
      [107, 6, 126, 8, 140, 22],
      [153, 36, 153, 56, 146, 73],
      [137, 94, 117, 110, 96, 114],
    ],
  },
  closed: {
    start: [90, 120],
    curves: [
      [74, 116, 62, 101, 62, 87],
      [61, 74, 70, 64, 82, 61],
      [93, 58, 102, 61, 111, 63],
      [126, 67, 137, 82, 136, 97],
      [135, 111, 121, 123, 108, 124],
      [101, 125, 96, 123, 90, 120],
    ],
  },
};
const outerRim: RoseContour = {
  open: {
    start: [49, 26],
    curves: [
      [59, 13, 78, 20, 91, 14],
      [107, 6, 126, 8, 140, 22],
      [147, 30, 151, 40, 151, 49],
      [138, 32, 123, 24, 108, 27],
      [90, 33, 72, 24, 58, 33],
      [49, 38, 46, 44, 44, 50],
      [42, 40, 44, 32, 49, 26],
    ],
  },
  closed: {
    start: [82, 61],
    curves: [
      [93, 58, 102, 61, 111, 63],
      [126, 67, 137, 82, 136, 97],
      [136, 104, 132, 111, 126, 116],
      [134, 101, 127, 86, 117, 77],
      [106, 67, 94, 63, 84, 67],
      [71, 70, 65, 79, 63, 89],
      [61, 77, 69, 65, 82, 61],
    ],
  },
};

// Inner petals turn back into the bowl rather than ending as pointed pinwheel blades.
const inner: RoseContour = {
  open: {
    start: [67, 108],
    curves: [
      [56, 108, 48, 82, 55, 61],
      [63, 45, 84, 39, 101, 45],
      [115, 47, 133, 48, 143, 64],
      [154, 81, 149, 101, 137, 106],
      [134, 107, 137, 79, 120, 71],
      [104, 65, 84, 72, 75, 87],
      [69, 94, 72, 108, 67, 108],
    ],
  },
  closed: {
    start: [85, 111],
    curves: [
      [76, 105, 72, 94, 76, 83],
      [81, 72, 92, 70, 102, 74],
      [111, 76, 120, 76, 124, 86],
      [129, 97, 121, 111, 111, 115],
      [119, 105, 118, 93, 108, 90],
      [98, 85, 89, 91, 87, 99],
      [85, 104, 85, 107, 85, 111],
    ],
  },
};
const innerRim: RoseContour = {
  open: {
    start: [55, 61],
    curves: [
      [63, 45, 84, 39, 101, 45],
      [115, 47, 133, 48, 143, 64],
      [149, 74, 150, 88, 145, 99],
      [144, 76, 126, 61, 109, 58],
      [89, 49, 70, 54, 59, 67],
      [54, 73, 53, 79, 52, 85],
      [50, 76, 52, 68, 55, 61],
    ],
  },
  closed: {
    start: [76, 83],
    curves: [
      [81, 72, 92, 70, 102, 74],
      [111, 76, 120, 76, 124, 86],
      [127, 93, 125, 100, 121, 106],
      [124, 95, 116, 81, 105, 80],
      [94, 74, 85, 78, 79, 86],
      [76, 90, 75, 95, 76, 100],
      [74, 95, 73, 89, 76, 83],
    ],
  },
};

const r = ROSE_CENTER.radius;
const handle = r * ((4 * (Math.sqrt(2) - 1)) / 3);
const center: RoseOutline = {
  start: [100, 100 - r],
  curves: [
    [100 + handle, 100 - r, 100 + r, 100 - handle, 100 + r, 100],
    [100 + r, 100 + handle, 100 + handle, 100 + r, 100, 100 + r],
    [100 - handle, 100 + r, 100 - r, 100 + handle, 100 - r, 100],
    [100 - r, 100 - handle, 100 - handle, 100 - r, 100, 100 - r],
  ],
};

function transformPoint(point: RosePoint, width: number, height: number, angle: number): RosePoint {
  const a = (angle * Math.PI) / 180;
  const x = (point[0] - 100) * width;
  const y = (point[1] - 100) * height;
  return [100 + x * Math.cos(a) - y * Math.sin(a), 100 + x * Math.sin(a) + y * Math.cos(a)];
}

// Four guard petals and four shorter, staggered petals retain eight pluck targets.
const outerPlacements = [
  { angle: -3, width: 0.91, height: 1, closedSize: 0.68 },
  { angle: 89, width: 0.95, height: 0.97, closedSize: 0.68 },
  { angle: 181, width: 0.94, height: 0.98, closedSize: 0.68 },
  { angle: 272, width: 0.93, height: 0.96, closedSize: 0.68 },
  { angle: 43, width: 0.86, height: 0.83, closedSize: 0.72 },
  { angle: 134, width: 0.9, height: 0.85, closedSize: 1.04, closedAngle: 134 },
  { angle: 226, width: 0.88, height: 0.84, closedSize: 1.04, closedAngle: 254 },
  { angle: 317, width: 0.87, height: 0.87, closedSize: 1.04, closedAngle: 374 },
] as const;

/** Paint order also defines pointer ownership: outer petals, inner wrap, then the center. */
export const ROSE_LAYERS: readonly RoseLayer[] = [
  ...outerPlacements.map((placement): RoseLayer => ({
    kind: 'outer',
    body: outer,
    rim: outerRim,
    ...placement,
    anchor: transformPoint([101, 35], placement.width, placement.height, placement.angle),
  })),
  ...Array.from({ length: INNER_COUNT }, (_, index): RoseLayer => ({
    kind: 'inner',
    body: inner,
    rim: innerRim,
    angle: (index * 360) / INNER_COUNT + 18,
    width: 0.83 + Math.sin(index * 2.4) * 0.025,
    height: 0.9 - index * 0.035,
    anchor: [100, 100],
  })),
  { kind: 'center', body: { open: center, closed: center }, angle: 0, width: 1, height: 1, anchor: [100, 100] },
];

const CLOSED_POSE = {
  outer: { width: 1, height: 1, turn: 14 },
  inner: { width: 0.88, height: 0.88, turn: 22 },
  center: { width: 0.18, height: 0.18, turn: 0 },
} as const;

export function flowerFoldPose(kind: RoseKind, fold: number) {
  const delay = kind === 'outer' ? 0.07 : 0;
  const t = Math.max(0, Math.min(1, (fold - delay) / (1 - delay)));
  const closed = CLOSED_POSE[kind];
  return {
    width: 1 + (closed.width - 1) * t,
    height: 1 + (closed.height - 1) * t,
    turn: closed.turn * t,
    curl: t * t * (3 - 2 * t),
  };
}

/** Three outer faces enclose the bud; the other petals tuck underneath continuously. */
export function roseLayerPose(layer: RoseLayer, fold: number) {
  const pose = flowerFoldPose(layer.kind, fold);
  const size = 1 + ((layer.closedSize ?? 1) - 1) * pose.curl;
  const turn = layer.closedAngle === undefined ? pose.turn : (layer.closedAngle - layer.angle) * pose.curl;
  return {
    width: layer.width * pose.width * size,
    height: layer.height * pose.height * size,
    angle: layer.angle + turn,
    curl: pose.curl,
  };
}

/** Match local control points before rotating; the bud has a wrapping contour of its own. */
export function roseLayerOutline(layer: RoseLayer, fold: number, detail: 'body' | 'rim' = 'body'): RoseOutline {
  const contour = layer[detail] ?? layer.body;
  const pose = roseLayerPose(layer, fold);
  const point = (x: number, y: number, closedX: number, closedY: number) =>
    transformPoint([x + (closedX - x) * pose.curl, y + (closedY - y) * pose.curl], pose.width, pose.height, pose.angle);
  return {
    start: point(...contour.open.start, ...contour.closed.start),
    curves: contour.open.curves.map((c, index): RoseCurve => {
      const closed = contour.closed.curves[index];
      return [
        ...point(c[0], c[1], closed[0], closed[1]),
        ...point(c[2], c[3], closed[2], closed[3]),
        ...point(c[4], c[5], closed[4], closed[5]),
      ];
    }),
  };
}
