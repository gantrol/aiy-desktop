import { FLOWER_PETAL_COUNT, flowerPetalAnchor, isPluckableFlowerPetal } from '@/shared/flower-geometry';
import { demoDesktopLayout } from '@/renderer/features/extensions/feature-demo/v050/demoDesktopScene';
import { between, clamp, mix, type Point } from '@/renderer/features/extensions/feature-demo/v050/demoProjection';
import {
  demoOutroCues,
  type DemoOutroNoteId,
} from '@/renderer/features/extensions/feature-demo/v050/demoOutroTimeline';

const flower = demoDesktopLayout.flower;
export const demoOutroLayout = {
  flower: {
    x: flower.x + flower.inset * flower.scale,
    y: flower.y + flower.inset * flower.scale,
    size: flower.size * flower.scale,
  },
  note: { x: 160, y: 298, width: 500, height: 400, scale: 1.7 },
  portrait: { x: 1070, y: 112, width: 456, height: 684 },
  release: [500, 370] as Point,
  rest: [1410, 952] as Point,
} as const;

export interface DemoOutroNoteTargets {
  collapse: Point;
  body: Point;
}

// Use two different outer petals, chosen from the product's actual hit geometry.
const petals = Array.from({ length: FLOWER_PETAL_COUNT }, (_, index) => index)
  .filter(isPluckableFlowerPetal)
  .sort((a, b) => flowerPetalAnchor(a)[0] - flowerPetalAnchor(b)[0]);
const notePetal = { generation: petals[0], origins: petals[1] };
// A shallow arc with the shared ease keeps starts and stops gentle, including seeks.
const travel = (from: Point, to: Point, progress: number): Point => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  const bend = Math.min(32, distance * 0.06) * 4 * progress * (1 - progress);
  return [
    mix(from[0], to[0], progress) - (distance ? (dy / distance) * bend : 0),
    mix(from[1], to[1], progress) + (distance ? (dx / distance) * bend : 0),
  ];
};

export function demoOutroNoteState(time: number, id: DemoOutroNoteId) {
  const cues = demoOutroCues[id];
  const { flower, release, note } = demoOutroLayout;
  const anchor = flowerPetalAnchor(notePetal[id]);
  const grab: Point = [flower.x + (anchor[0] * flower.size) / 200, flower.y + (anchor[1] * flower.size) / 200];
  const position = travel(grab, release, between(time, cues.drag, cues.release));
  const delta: Point = [position[0] - grab[0], position[1] - grab[1]];
  const distance = Math.hypot(...delta);
  const detached = clamp((distance - 12) / 36);
  const opening = between(time, cues.release, cues.opened);
  const closing = between(time, cues.close, cues.closed);
  const regrowth = between(time, cues.release, cues.opened + 0.4);
  const sourceTravel = distance ? Math.min(1, 48 / distance) * (1 - regrowth) : 0;
  const plucking = time >= cues.grab && time < cues.opened + 0.4;
  const restingPetal: Point = [note.x + 48 + (id === 'origins' ? 92 : 0), note.y + note.height * note.scale - 50];
  const collapsedScale = 0.12;
  const offsetAt = (point: Point): Point => [
    (point[0] - note.x) / note.scale - (note.width * collapsedScale) / 2,
    (point[1] - note.y) / note.scale - (note.height * collapsedScale) / 2,
  ];
  const openingOffset = offsetAt(release);
  const closingOffset = offsetAt(restingPetal);
  return {
    grab,
    pull: plucking
      ? {
          index: notePetal[id],
          x: (delta[0] * sourceTravel * 200) / flower.size,
          y: (delta[1] * sourceTravel * 200) / flower.size,
          pointerX: position[0] - flower.x,
          pointerY: position[1] - flower.y,
          detached: detached * (1 - regrowth),
          phase: 'pulling' as const,
        }
      : null,
    petal: {
      position: time >= cues.close ? restingPetal : position,
      opacity: time < cues.close ? detached * (1 - clamp(opening * 2)) : clamp((closing - 0.35) / 0.65),
    },
    note: {
      opacity: clamp(opening * 2) * (1 - clamp((closing - 0.35) / 0.65)),
      scale: mix(collapsedScale, 1, opening) * mix(1, collapsedScale, closing),
      offset: [
        openingOffset[0] * (1 - opening) + closingOffset[0] * closing,
        openingOffset[1] * (1 - opening) + closingOffset[1] * closing,
      ] as Point,
    },
  };
}

export function demoOutroScene(time: number, { collapse, body }: DemoOutroNoteTargets) {
  const { generation, origins } = demoOutroCues;
  const first = demoOutroNoteState(time, 'origins');
  const second = demoOutroNoteState(time, 'generation');
  const id = time >= generation.approach ? 'generation' : 'origins';
  const cues = demoOutroCues[id];
  const state = id === 'origins' ? first : second;
  const { release, rest } = demoOutroLayout;
  const from = id === 'origins' ? rest : collapse;
  let cursor = travel(from, state.grab, between(time, cues.approach, cues.grab));
  if (time >= cues.drag) cursor = travel(state.grab, release, between(time, cues.drag, cues.release));
  if (time >= cues.opened) cursor = travel(release, rest, between(time, cues.opened, cues.opened + 0.55));
  if (id === 'generation' && time >= generation.opened) {
    cursor = travel(release, body, between(time, generation.pasteApproach, generation.pasteFocus));
    if (time >= generation.leave) cursor = travel(body, rest, between(time, generation.leave, generation.rested));
  }
  if (time >= cues.closeApproach) cursor = travel(rest, collapse, between(time, cues.closeApproach, cues.close));
  if (time >= generation.closed)
    cursor = travel(collapse, rest, between(time, generation.closed, demoOutroCues.repository));
  return {
    notes: { origins: first, generation: second },
    pull: first.pull ?? second.pull,
    cursor,
    cursorVisible: time >= origins.approach && time < demoOutroCues.repository,
    pressed:
      (time >= cues.grab && time < cues.release) ||
      (time >= generation.pasteFocus && time < generation.pasteFocus + 0.12),
    pulse: [
      generation.grab,
      generation.release,
      generation.pasteFocus,
      generation.close,
      origins.grab,
      origins.release,
      origins.close,
    ].some((cue) => time >= cue && time < cue + 0.18),
    opacity: between(time, demoOutroCues.desktop, demoOutroCues.revealed),
    brandCompact:
      between(time, origins.approach, origins.release) * (1 - between(time, generation.close, generation.closed + 0.6)),
    brand: between(time, demoOutroCues.brand, demoOutroCues.brand + 0.9),
    slogan: between(time, demoOutroCues.slogan, demoOutroCues.slogan + 0.8),
    secondarySlogan: between(time, demoOutroCues.secondarySlogan, demoOutroCues.secondarySlogan + 0.8),
    repository: between(time, demoOutroCues.repository, demoOutroCues.repository + 0.75),
  };
}
