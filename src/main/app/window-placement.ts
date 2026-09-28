import { screen, type Rectangle } from 'electron';

export const DEFAULT_WINDOW_WIDTH = 1_500;
export const DEFAULT_WINDOW_HEIGHT = 920;
export const MINIMUM_WINDOW_WIDTH = 1_100;
export const MINIMUM_WINDOW_HEIGHT = 720;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function restoreWindowBounds(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const width = Math.min(Math.max(bounds.width, MINIMUM_WINDOW_WIDTH), workArea.width);
  const height = Math.min(Math.max(bounds.height, MINIMUM_WINDOW_HEIGHT), workArea.height);
  return {
    x: clamp(bounds.x, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - width)),
    y: clamp(bounds.y, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}
