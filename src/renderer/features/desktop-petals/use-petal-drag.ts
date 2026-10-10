import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

type Point = { x: number; y: number };
interface Gesture {
  pointerId: number;
  target: Element;
  origin: Point;
  local: Point;
  last: Point;
  moved: boolean;
  begun: boolean;
  next: Point | null;
  moving: Promise<void> | null;
  frame: number | null;
}
const point = (event: { screenX: number; screenY: number }): Point => ({
  x: Math.round(event.screenX),
  y: Math.round(event.screenY),
});
function releaseCapture(active: Gesture) {
  if (active.frame !== null) cancelAnimationFrame(active.frame);
  active.frame = null;
  if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
}
/** Keep only the newest position while an IPC move is in flight. */
function move(active: Gesture): Promise<void> {
  if (active.moving) return active.moving;
  active.moving = (async () => {
    if (!active.begun) {
      active.begun = true;
      await window.desktopPetals.beginDrag(active.origin, active.local);
    }
    while (active.next) {
      const destination = active.next;
      active.next = null;
      await window.desktopPetals.move(destination);
    }
  })().finally(() => {
    active.moving = null;
  });
  return active.moving;
}

export function usePetalDrag(onClick?: () => void, onError?: (reason: unknown) => void) {
  const gesture = useRef<Gesture | null>(null);
  const settling = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onClick, onError });
  callbacks.current = { onClick, onError };
  const [dragging, setDragging] = useState(false);
  const finish = useCallback((cancelled: boolean, destination?: Point, released = false) => {
    const active = gesture.current;
    if (!active) return;
    if (destination && Math.hypot(destination.x - active.origin.x, destination.y - active.origin.y) >= 6)
      active.moved = true;
    gesture.current = null;
    releaseCapture(active);
    if (!active.moved) {
      if (released && !cancelled) callbacks.current.onClick?.();
      return;
    }
    const finalPoint = destination ?? active.last;
    active.next = null;
    settling.current = true;
    // Menus and hover previews must stay disabled until native geometry has settled.
    if (mounted.current) setDragging(true);
    void (async () => {
      let rollback = cancelled;
      try {
        await move(active);
      } catch (reason) {
        rollback = true;
        callbacks.current.onError?.(reason);
      } finally {
        try {
          await window.desktopPetals.endDrag(rollback, released, finalPoint);
        } catch (reason) {
          callbacks.current.onError?.(reason);
        } finally {
          settling.current = false;
          if (mounted.current) setDragging(false);
        }
      }
    })();
  }, []);
  const pointerMove = useCallback(
    (event: globalThis.PointerEvent) => {
      const active = gesture.current;
      if (!active || active.pointerId !== event.pointerId) return;
      // A later button-free move is not the missing pointerup, nor its release position.
      if (!(event.buttons & 1)) return finish(false);
      const destination = point(event);
      active.last = destination;
      if (!active.moved && Math.hypot(destination.x - active.origin.x, destination.y - active.origin.y) < 6) return;
      if (!active.moved) setDragging(true);
      active.moved = true;
      active.next = destination;
      if (active.frame === null)
        active.frame = requestAnimationFrame(() => {
          active.frame = null;
          void move(active).catch((reason) => {
            if (gesture.current === active) {
              callbacks.current.onError?.(reason);
              finish(true);
            }
          });
        });
    },
    [finish],
  );
  useEffect(() => {
    mounted.current = true;
    const up = (event: globalThis.PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) finish(false, point(event), true);
    };
    const cancel = (event: globalThis.PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) finish(true);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    };
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      mounted.current = false;
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', escape, true);
      finish(false);
    };
  }, [finish, pointerMove]);
  return {
    dragging,
    handlers: {
      onPointerDown(event: PointerEvent<Element>) {
        if (event.button !== 0 || !event.isPrimary || gesture.current || settling.current) return;
        event.preventDefault();
        const active: Gesture = {
          pointerId: event.pointerId,
          target: event.currentTarget,
          origin: point(event),
          local: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
          last: point(event),
          moved: false,
          begun: false,
          next: null,
          moving: null,
          frame: null,
        };
        gesture.current = active;
        try {
          active.target.setPointerCapture(active.pointerId);
        } catch (reason) {
          finish(true);
          callbacks.current.onError?.(reason);
        }
      },
      onPointerEnter(event: PointerEvent<Element>) {
        if (!(event.buttons & 1)) finish(false);
      },
      onClick(event: React.MouseEvent<Element>) {
        if (event.detail === 0 && !settling.current) callbacks.current.onClick?.();
      },
      onDragStart(event: React.DragEvent<Element>) {
        event.preventDefault();
      },
    },
  };
}
