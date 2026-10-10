import { useRef, type KeyboardEvent, type WheelEvent } from 'react';
import type { PetalWindowToolsCommand } from '@/shared/contracts/petal-window-tools';

export function useImagePinNavigation(enabled: boolean, onError: (reason: unknown) => void) {
  const pending = useRef(false);
  const run = (command: PetalWindowToolsCommand) => {
    if (!enabled || pending.current) return;
    pending.current = true;
    void window.desktopPetals
      .windowTools(command)
      .catch(onError)
      .finally(() => {
        pending.current = false;
      });
  };
  return {
    onWheel(event: WheelEvent) {
      if (!enabled || !event.deltaY) return;
      event.preventDefault();
      run({ kind: 'imageZoom', direction: event.deltaY < 0 ? 1 : -1 });
    },
    onKeyDown(event: KeyboardEvent) {
      if (!enabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      run({
        kind: 'nudge',
        x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
      });
    },
  };
}
