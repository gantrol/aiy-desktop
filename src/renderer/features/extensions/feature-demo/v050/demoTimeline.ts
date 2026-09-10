import { demoOutroCues } from '@/renderer/features/extensions/feature-demo/v050/demoOutroTimeline';

export const DEMO_FPS = 30;
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;
const originalCues = {
  paperEnd: 46 / DEMO_FPS,
  // With the v3 plate and current hand bounds, visible entry is F47;
  // F34–F46 remain still for 13 frames (0.433 seconds).
  handEnter: 1.2,
  cut: 2.3,
  handExit: 2.95,
  cameraEnd: 4.5,
  cursorStart: 4.8,
  cursorArrive: 5.7,
  collapse: 6,
  collapsed: 6.3,
  dragApproach: 6.7,
  dragPress: 7.4,
  dragStart: 7.65,
  dragArrive: 9.3,
  collect: 9.55,
  undoApproach: 10.45,
  undoArrive: 11.05,
  undo: 11.4,
  cursorLeave: 11.85,
  cursorRest: 12.65,
  menuApproach: 13,
  menuArrive: 13.65,
  menuOpen: 14,
  menuSelect: 14.45,
  menuHover: 15.1,
  openMain: 15.5,
  workspace: 15.75,
  promptApproach: 16.2,
  promptFocus: 17,
  typingStart: 17.25,
  typingEnd: 19.45,
  generateApproach: 20,
  generateHover: 20.7,
  generate: 21,
  result: 21.8,
  resultApproach: 22.35,
  resultHover: 23.2,
  magnify: 23.65,
  faceApproach: 24,
  faceArrive: 24.8,
  faceHoldEnd: 27,
  faceLeave: 27.25,
  variantApproach: 27.6,
  variantHover: 28.3,
  variantOpen: 28.6,
  gifApproach: 28.85,
  gifHover: 29.4,
  gifOpen: 29.8,
  gifWorkspace: 30.1,
  gifRest: 30.8,
  motionApproach: 31.2,
  motionFocus: 31.9,
  motionTypingStart: 32.1,
  motionTypingEnd: 35.5,
  planApproach: 36.2,
  planHover: 36.8,
  planRequest: 37.1,
  planReady: 37.8,
  confirmApproach: 38.1,
  confirmHover: 38.6,
  confirm: 38.8,
  motionResult: 39.4,
  frameApproach: 39.8,
  frameHover: 40.5,
  frameSelect: 40.8,
  playApproach: 41.6,
  playHover: 42.3,
  motionPlay: 42.7,
  motionCloseup: 43.5,
  motionFace: 44.5,
  motionWide: 49.9,
  motionWideEnd: 51,
  motionHold: 52,
} as const;

const typingEdits = [
  { start: originalCues.typingStart, end: originalCues.typingEnd, speed: 4 },
  { start: originalCues.motionTypingStart, end: originalCues.motionTypingEnd, speed: 3 },
] as const;

// Remove only typing time. All later mouse, camera, reading and smile intervals retain their durations.
export const demoCues = Object.fromEntries(
  Object.entries(originalCues).map(([cue, time]) => [
    cue,
    time -
      typingEdits.reduce(
        (removed, edit) => removed + Math.max(0, Math.min(time, edit.end) - edit.start) * (1 - 1 / edit.speed),
        0,
      ),
  ]),
) as { readonly [Key in keyof typeof originalCues]: number };

export const DEMO_DURATION = demoCues.motionHold + demoOutroCues.end;
export const demoChapters = [
  { id: 'paper', start: 0 },
  { id: 'reveal', start: 47 / DEMO_FPS },
  { id: 'camera', start: demoCues.handExit },
  { id: 'collapse', start: demoCues.cursorStart },
  { id: 'collect', start: demoCues.dragApproach },
  { id: 'undo', start: demoCues.undoApproach },
  { id: 'openMain', start: demoCues.menuApproach },
  { id: 'prompt', start: demoCues.workspace },
  { id: 'roses', start: demoCues.result },
  { id: 'face', start: demoCues.resultApproach },
  { id: 'variant', start: demoCues.variantApproach },
  { id: 'gif', start: demoCues.gifWorkspace },
  { id: 'motionPrompt', start: demoCues.motionApproach },
  { id: 'motionPlan', start: demoCues.planReady },
  { id: 'motionResult', start: demoCues.motionResult },
  { id: 'smile', start: demoCues.motionPlay },
  { id: 'outroDesktop', start: demoCues.motionHold },
  { id: 'outroBrand', start: demoCues.motionHold + demoOutroCues.brand },
  { id: 'outroOrigins', start: demoCues.motionHold + demoOutroCues.origins.approach },
  { id: 'outroGeneration', start: demoCues.motionHold + demoOutroCues.generation.approach },
  { id: 'outroDownloads', start: demoCues.motionHold + demoOutroCues.repository },
  { id: 'outroExit', start: demoCues.motionHold + demoOutroCues.returnWindow },
] as const;

export const demoCollectedAt = (time: number) => time >= demoCues.collect && time < demoCues.undo;
export const demoMenuAt = (time: number) => time >= demoCues.menuOpen && time < demoCues.openMain;
export const demoFrameTime = (time: number) =>
  Math.max(0, Math.min(DEMO_DURATION, Math.round(time * DEMO_FPS) / DEMO_FPS));
export const demoChapterAt = (time: number) =>
  [...demoChapters].reverse().find((chapter) => time >= chapter.start) ?? demoChapters[0];
