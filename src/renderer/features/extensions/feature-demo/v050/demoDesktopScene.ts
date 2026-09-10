import { ROSE_CENTER } from '@/shared/flower-geometry';
import { PETAL_SHAPE_ANCHOR } from '@/renderer/features/desktop-petals/petal-shape-layout';
import { between, mix, type Point } from '@/renderer/features/extensions/feature-demo/v050/demoProjection';
import { demoCollectedAt, demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import type { DemoTarget } from '@/renderer/features/extensions/feature-demo/v050/demoProtocol';
import {
  demoFaceTarget,
  demoWorkspaceCamera,
} from '@/renderer/features/extensions/feature-demo/v050/demoWorkspaceScene';

export const demoDesktopLayout = {
  note: { x: 270, y: 300, width: 410, height: 455 },
  petal: { x: 391, y: 447, width: 112, height: 112, scale: 1.5 },
  flower: { x: 1550, y: 730, width: 224, height: 224, inset: 8, size: 208, scale: 1.4 },
} as const;

export const demoDefaultTargets = {
  note: [382, 27],
  petal: [PETAL_SHAPE_ANCHOR.x, PETAL_SHAPE_ANCHOR.y],
  flower: [112, 8 + (ROSE_CENTER.y * 208) / 200],
  openMain: [1750, 820],
  prompt: [360, 415],
  generate: [905, 680],
  result: [1350, 505],
  magnify: [1832, 936],
  variant: [1740, 108],
  gif: [1630, 153],
  motionPrompt: [1020, 260],
  motionPlan: [1815, 1020],
  motionConfirm: [1815, 1020],
  motionFrame: [768, 1000],
  motionPlay: [390, 912],
  motionFace: [1178, 320],
} satisfies Record<DemoTarget, Point>;

const travel = (from: Point, to: Point, progress: number): Point => [
  mix(from[0], to[0], progress),
  mix(from[1], to[1], progress),
];

export const demoFlowerFoldAt = (time: number) =>
  1 -
  between(time, demoCues.collect, demoCues.collect + 0.45) +
  between(time, demoCues.undo + 0.3, demoCues.undo + 0.85);

export function demoFlowerCenter(time: number, target: Point = demoDefaultTargets.flower): Point {
  const { flower } = demoDesktopLayout;
  const fold = demoFlowerFoldAt(time);
  const boost = 1 + fold * 0.5;
  return [
    flower.x + (112 + (mix(target[0], 112, fold) - 112) * boost) * flower.scale,
    flower.y + (112 + (mix(target[1], 112, fold) - 112) * boost) * flower.scale,
  ];
}

/** Absolute-time projection: seeking and replaying cannot leave a stale drag or undo state. */
export function demoDesktopScene(time: number, targets = demoDefaultTargets) {
  const { note, petal } = demoDesktopLayout;
  const collapse: Point = [note.x + targets.note[0], note.y + targets.note[1]];
  const grab: Point = [petal.x + targets.petal[0] * petal.scale, petal.y + targets.petal[1] * petal.scale];
  const center = demoFlowerCenter(time, targets.flower);
  const drag = between(time, demoCues.dragStart, demoCues.dragArrive);
  const destination = travel(grab, center, drag);
  const afterDrop: Point = [center[0] - 180, center[1] - 90];
  let cursor = travel([1100, 830], collapse, between(time, demoCues.cursorStart, demoCues.cursorArrive));
  if (time >= demoCues.dragApproach)
    cursor = travel(collapse, grab, between(time, demoCues.dragApproach, demoCues.dragPress));
  if (time >= demoCues.dragStart) cursor = destination;
  if (time >= demoCues.collect + 0.22)
    cursor = travel(center, afterDrop, between(time, demoCues.collect + 0.22, demoCues.undoApproach));
  if (time >= demoCues.undoApproach)
    cursor = travel(afterDrop, center, between(time, demoCues.undoApproach, demoCues.undoArrive));
  if (time >= demoCues.cursorLeave)
    cursor = travel(center, [1400, 990], between(time, demoCues.cursorLeave, demoCues.cursorRest));
  if (time >= demoCues.menuApproach)
    cursor = travel([1400, 990], center, between(time, demoCues.menuApproach, demoCues.menuArrive));
  if (time >= demoCues.menuSelect)
    cursor = travel(center, targets.openMain, between(time, demoCues.menuSelect, demoCues.menuHover));
  if (time >= demoCues.promptApproach)
    cursor = travel(targets.openMain, targets.prompt, between(time, demoCues.promptApproach, demoCues.promptFocus));
  if (time >= demoCues.generateApproach)
    cursor = travel(targets.prompt, targets.generate, between(time, demoCues.generateApproach, demoCues.generateHover));
  if (time >= demoCues.resultApproach)
    cursor = travel(targets.generate, targets.magnify, between(time, demoCues.resultApproach, demoCues.resultHover));
  if (time >= demoCues.faceApproach)
    cursor = travel(targets.magnify, demoFaceTarget(time), between(time, demoCues.faceApproach, demoCues.faceArrive));
  if (time >= demoCues.variantApproach)
    cursor = travel(
      demoFaceTarget(demoCues.faceHoldEnd),
      targets.variant,
      between(time, demoCues.variantApproach, demoCues.variantHover),
    );
  if (time >= demoCues.gifApproach)
    cursor = travel(targets.variant, targets.gif, between(time, demoCues.gifApproach, demoCues.gifHover));
  if (time >= demoCues.gifWorkspace)
    cursor = travel(targets.gif, [1280, 830], between(time, demoCues.gifWorkspace, demoCues.gifRest));
  if (time >= demoCues.motionApproach)
    cursor = travel([1280, 830], targets.motionPrompt, between(time, demoCues.motionApproach, demoCues.motionFocus));
  if (time >= demoCues.planApproach)
    cursor = travel(targets.motionPrompt, targets.motionPlan, between(time, demoCues.planApproach, demoCues.planHover));
  if (time >= demoCues.confirmApproach)
    cursor = travel(
      targets.motionPlan,
      targets.motionConfirm,
      between(time, demoCues.confirmApproach, demoCues.confirmHover),
    );
  if (time >= demoCues.frameApproach)
    cursor = travel(
      targets.motionConfirm,
      targets.motionFrame,
      between(time, demoCues.frameApproach, demoCues.frameHover),
    );
  if (time >= demoCues.playApproach)
    cursor = travel(targets.motionFrame, targets.motionPlay, between(time, demoCues.playApproach, demoCues.playHover));
  if (time >= demoCues.workspace) {
    const camera = demoWorkspaceCamera(time, targets);
    cursor = [cursor[0] * camera.scale + camera.x, cursor[1] * camera.scale + camera.y];
  }
  const restored = time >= demoCues.undo;
  return {
    cursor,
    cursorVisible: (time < demoCues.faceArrive || time >= demoCues.faceLeave) && time < demoCues.motionPlay + 0.4,
    pressed: time >= demoCues.dragPress && time < demoCues.collect,
    pulse: [
      demoCues.collapse,
      demoCues.dragPress,
      demoCues.collect,
      demoCues.undo,
      demoCues.menuOpen,
      demoCues.openMain,
      demoCues.promptFocus,
      demoCues.generate,
      demoCues.magnify,
      demoCues.variantOpen,
      demoCues.gifOpen,
      demoCues.motionFocus,
      demoCues.planRequest,
      demoCues.confirm,
      demoCues.frameSelect,
      demoCues.motionPlay,
    ].some((cue) => time >= cue && time < cue + 0.22),
    noteClose: between(time, demoCues.collapse, demoCues.collapsed),
    petalVisible: time >= demoCues.collapsed && !demoCollectedAt(time),
    petalPosition: restored
      ? [petal.x, petal.y]
      : [destination[0] - targets.petal[0] * petal.scale, destination[1] - targets.petal[1] * petal.scale],
    collected: demoCollectedAt(time),
  };
}
