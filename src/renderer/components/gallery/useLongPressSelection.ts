import { useEffect, useRef, type MouseEventHandler, type PointerEventHandler } from 'react';

const touchDelay = 420;
const mouseDelay = 520;
const movementThreshold = 8;

export function longPressMovedTooFar(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = movementThreshold,
) {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}

/**
 * Pointer-based long press used as a supplementary batch-selection gesture.
 * The explicit Select action and card checkbox remain the discoverable paths.
 */
export function useLongPressSelection(onLongPress: () => void, disabled = false) {
  const callbackRef = useRef(onLongPress);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);
  callbackRef.current = onLongPress;

  function cancelTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
    pointerIdRef.current = null;
  }

  useEffect(() => cancelTimer, []);

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (disabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    cancelTimer();
    triggeredRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
    pointerIdRef.current = event.pointerId;
    timerRef.current = setTimeout(
      () => {
        timerRef.current = null;
        triggeredRef.current = true;
        callbackRef.current();
      },
      event.pointerType === 'mouse' ? mouseDelay : touchDelay,
    );
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    if (event.pointerId !== pointerIdRef.current || !startRef.current) return;
    if (longPressMovedTooFar(startRef.current, { x: event.clientX, y: event.clientY })) cancelTimer();
  };

  const onPointerEnd: PointerEventHandler<HTMLElement> = (event) => {
    if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
    cancelTimer();
  };

  const onClickCapture: MouseEventHandler<HTMLElement> = (event) => {
    if (!triggeredRef.current) return;
    triggeredRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onPointerLeave: onPointerEnd,
    onClickCapture,
  };
}
