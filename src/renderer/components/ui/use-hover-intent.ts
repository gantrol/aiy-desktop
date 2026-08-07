import { useEffect, useRef } from 'react';

export const HOVER_INTENT_DELAY_MS = 180;

export interface HoverIntentController {
  cancel(): void;
  schedule(action: () => void, enabled?: boolean): void;
}

/** Delays pointer-only navigation until the user has intentionally paused. */
export function createHoverIntent(delay = HOVER_INTENT_DELAY_MS): HoverIntentController {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  return {
    cancel,
    schedule(action, enabled = true) {
      cancel();
      if (!enabled) return;
      timer = setTimeout(() => {
        timer = null;
        action();
      }, delay);
    },
  };
}

export function useHoverIntent(delay = HOVER_INTENT_DELAY_MS) {
  const controllerRef = useRef<HoverIntentController | null>(null);
  if (controllerRef.current === null) controllerRef.current = createHoverIntent(delay);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller?.cancel();
  }, []);

  return controllerRef.current;
}
