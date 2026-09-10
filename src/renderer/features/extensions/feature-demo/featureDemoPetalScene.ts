import { FLOWER_PETAL_COUNT, flowerPetalAnchor, isPluckableFlowerPetal } from '@/shared/flower-geometry';

export const PETAL_DEMO_LAYOUT = {
  flower: { x: 160, y: 236, size: 248 },
  note: { x: 688, y: 168, width: 388, height: 432 },
  release: { x: 740, y: 264 },
} as const;

const petalIndex = Array.from({ length: FLOWER_PETAL_COUNT }, (_, index) => index)
  .filter(isPluckableFlowerPetal)
  .reduce((rightmost, index) => (flowerPetalAnchor(index)[0] > flowerPetalAnchor(rightmost)[0] ? index : rightmost));
const anchor = flowerPetalAnchor(petalIndex);
const grab = {
  x: PETAL_DEMO_LAYOUT.flower.x + (anchor[0] * PETAL_DEMO_LAYOUT.flower.size) / 200,
  y: PETAL_DEMO_LAYOUT.flower.y + (anchor[1] * PETAL_DEMO_LAYOUT.flower.size) / 200,
};
const rest = { x: 1136, y: 620 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const between = (value: number, start: number, end: number) => {
  const fraction = clamp((value - start) / (end - start));
  return fraction * fraction * (3 - 2 * fraction);
};
const travel = (from: typeof grab, to: typeof grab, progress: number) => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
});

/** Absolute-time state: a fresh petal is pulled free, released and opened into a blank note. */
export function petalDemoStateAt(progress: number) {
  const drag = between(progress, 0.22, 0.6);
  const point = travel(grab, PETAL_DEMO_LAYOUT.release, drag);
  const delta = { x: point.x - grab.x, y: point.y - grab.y };
  const distance = Math.hypot(delta.x, delta.y);
  const detached = clamp((distance - 12) / 36);
  const opening = between(progress, 0.62, 0.74);
  const regrowth = between(progress, 0.68, 0.82);
  const sourceTravel = distance ? Math.min(1, 48 / distance) * (1 - regrowth) : 0;
  const pull =
    progress < 0.22 || progress >= 0.82
      ? null
      : {
          index: petalIndex,
          x: (delta.x * sourceTravel * 200) / PETAL_DEMO_LAYOUT.flower.size,
          y: (delta.y * sourceTravel * 200) / PETAL_DEMO_LAYOUT.flower.size,
          pointerX: point.x - PETAL_DEMO_LAYOUT.flower.x,
          pointerY: point.y - PETAL_DEMO_LAYOUT.flower.y,
          detached: detached * (1 - regrowth),
          phase: 'pulling' as const,
        };
  return {
    pull,
    petal: { ...point, opacity: detached * (1 - opening) },
    note: { visible: progress >= 0.62, opacity: opening, scale: 0.18 + 0.82 * opening },
    cursor:
      progress < 0.22
        ? travel(rest, grab, between(progress, 0.06, 0.2))
        : progress < 0.74
          ? point
          : travel(PETAL_DEMO_LAYOUT.release, rest, between(progress, 0.74, 0.86)),
  };
}

// The cursor is drawn separately. Reuse the last capture while the underlying scene is stationary.
export function petalDemoCaptureKey(progress: number) {
  const { pull, petal, note } = petalDemoStateAt(progress);
  return JSON.stringify({ pull, petal: petal.opacity > 0 ? petal : null, note });
}
