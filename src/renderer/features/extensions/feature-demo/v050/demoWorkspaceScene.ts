import { between, clamp, mix, type Point } from '@/renderer/features/extensions/feature-demo/v050/demoProjection';
import { DEMO_WIDTH, DEMO_HEIGHT, demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import type { DemoTarget } from '@/renderer/features/extensions/feature-demo/v050/demoProtocol';

export const demoWorkspaceLayout = {
  rail: 72,
  library: 280,
  input: 1020,
  output: 548,
  chrome: 80,
  image: { x: 1396, y: 177, width: 500, height: 750 },
} as const;

/** Normalized coordinates in the supplied, unmodified 1024 × 1536 rose image. */
export function demoFacePoint(time: number) {
  const progress = between(time, demoCues.faceArrive, demoCues.faceHoldEnd);
  return { x: mix(0.61, 0.575, progress), y: mix(0.176, 0.16, progress) };
}

export function demoFaceTarget(time: number): Point {
  const { image } = demoWorkspaceLayout;
  const point = demoFacePoint(time);
  return [image.x + image.width * point.x, image.y + image.height * point.y];
}

/** Camera moves outside the subframe, so component geometry stays in native coordinates. */
export function demoWorkspaceCamera(
  time: number,
  targets: Pick<Record<DemoTarget, Point>, 'prompt' | 'motionPrompt' | 'motionFace'>,
) {
  let focus: Point = [targets.prompt[0] + 130, targets.prompt[1] + 44];
  let closeup =
    between(time, demoCues.promptApproach, demoCues.typingStart) *
    (1 - between(time, demoCues.typingEnd + 0.35, demoCues.generateHover));
  let maximum = 2.4;
  if (time >= demoCues.motionApproach) {
    focus = [targets.motionPrompt[0] + 250, targets.motionPrompt[1] + 60];
    maximum = 1.8;
    closeup =
      between(time, demoCues.motionApproach, demoCues.motionTypingStart) *
      (1 - between(time, demoCues.motionTypingEnd + 0.35, demoCues.planHover));
  }
  if (time >= demoCues.motionCloseup) {
    focus = targets.motionFace;
    maximum = 1.85;
    closeup =
      between(time, demoCues.motionCloseup, demoCues.motionFace) *
      (1 - between(time, demoCues.motionWide, demoCues.motionWideEnd));
  }
  const scale = mix(1, maximum, closeup);
  const x = Math.max(DEMO_WIDTH * (1 - scale), Math.min(0, DEMO_WIDTH / 2 - focus[0] * scale));
  const y = Math.max(DEMO_HEIGHT * (1 - scale), Math.min(0, DEMO_HEIGHT * 0.45 - focus[1] * scale));
  return { scale, x, y, transform: `translate(${x}px, ${y}px) scale(${scale})` };
}

export function demoPromptText(
  time: number,
  text: string,
  start: number = demoCues.typingStart,
  end: number = demoCues.typingEnd,
) {
  const characters = Array.from(text);
  return characters.slice(0, Math.floor(characters.length * clamp((time - start) / (end - start)))).join('');
}
