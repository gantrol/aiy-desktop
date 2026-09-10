import { between, mix, type Point } from '@/renderer/features/extensions/feature-demo/v050/demoProjection';
import { demoOutroCues } from '@/renderer/features/extensions/feature-demo/v050/demoOutroTimeline';

export const demoExitLayout = {
  preview: { x: 550, y: 246, width: 1280 },
  tray: [1825, 1052] as Point,
  menu: { x: 1455, y: 838, width: 284, scale: 1.5 },
};
export interface DemoExitTargets {
  quit: Point;
}
export interface DemoExitPreview {
  x: number;
  y: number;
  width: number;
}

export function demoExitScene(time: number, quit: Point, preview: DemoExitPreview) {
  const cues = demoOutroCues;
  const { tray } = demoExitLayout;
  const returning = between(time, cues.returnWindow, cues.returnWindowEnd);
  const move = between(time, cues.trayApproach, cues.trayHover);
  const select = between(time, cues.quitApproach, cues.quitHover);
  const cursor: Point =
    time < cues.quitApproach
      ? [mix(1500, tray[0], move), mix(900, tray[1], move)]
      : [mix(tray[0], quit[0], select), mix(tray[1], quit[1], select)];
  return {
    transform: `translate(${preview.x * returning}px, ${preview.y * returning}px) scale(${mix(1, preview.width / 1920, returning)})`,
    cursor,
    cursorVisible: time >= cues.trayApproach && time < cues.closed,
    pressed: [cues.trayOpen, cues.quitClick].some((cue) => time >= cue && time < cue + 0.14),
    pulse: [cues.trayOpen, cues.quitClick].some((cue) => time >= cue && time < cue + 0.18),
  };
}
