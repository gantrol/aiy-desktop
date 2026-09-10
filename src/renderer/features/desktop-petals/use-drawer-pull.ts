import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { PetalDrawerFrame } from '@/shared/contracts/petal-drawer';

type Point = { x: number; y: number };
const point = (event: { screenX: number; screenY: number }): Point => ({
  x: Math.round(event.screenX),
  y: Math.round(event.screenY),
});
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useDrawerPull(frame: PetalDrawerFrame, disabled: boolean, onError: (error: unknown) => void) {
  const latest = useRef({ frame, disabled, onError });
  latest.current = { frame, disabled, onError };
  const active = useRef<{
    origin: Point;
    last: Point;
    moved: boolean;
    token: string;
    begun: boolean;
    pointerId: number;
    target: HTMLElement;
    next?: Point;
    running?: Promise<void>;
  } | null>(null);
  const settling = useRef(false);
  const send = useCallback(async (gesture: NonNullable<typeof active.current>) => {
    if (gesture.running) return gesture.running;
    gesture.running = (async () => {
      if (!gesture.begun) {
        gesture.begun = true;
        await window.desktopPetals.drawer({ kind: 'begin-pull', point: gesture.origin, token: gesture.token });
      }
      while (gesture.next) {
        const next = gesture.next;
        gesture.next = undefined;
        await window.desktopPetals.drawer({ kind: 'pull', point: next });
      }
    })().finally(() => {
      gesture.running = undefined;
    });
    return gesture.running;
  }, []);
  useEffect(() => {
    const finish = async (cancel: boolean, destination?: Point) => {
      const gesture = active.current;
      if (!gesture) return;
      active.current = null;
      settling.current = true;
      if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
      try {
        if (gesture.moved) {
          gesture.next = destination ?? gesture.last;
          await send(gesture);
          await window.desktopPetals.drawer({ kind: 'end-pull', cancel, reduced: reduced() });
        } else if (!cancel) {
          if (latest.current.frame.moving)
            await window.desktopPetals.drawer({ kind: 'move-key', dx: 0, dy: 0, finish: true });
          else await window.desktopPetals.drawer({ kind: 'toggle', reduced: reduced() });
        }
      } catch (error) {
        latest.current.onError(error);
      } finally {
        settling.current = false;
      }
    };
    const move = (event: PointerEvent) => {
      const gesture = active.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.last = point(event);
      if (!gesture.moved && !(event.buttons & 1)) return;
      const dx = Math.abs(gesture.last.x - gesture.origin.x),
        dy = Math.abs(gesture.last.y - gesture.origin.y);
      if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
      gesture.moved = true;
      gesture.next = gesture.last;
      void send(gesture).catch((error) => {
        latest.current.onError(error);
        void finish(true);
      });
    };
    const up = (event: PointerEvent) => {
      if (active.current?.pointerId === event.pointerId) void finish(false, point(event));
    };
    const cancel = () => {
      void finish(true);
    };
    const pointerCancel = () => {
      if (!active.current?.moved) cancel();
    };
    const unsubscribePointer = window.desktopPetals.onDrawerPointer(({ token, point, released }) => {
      const gesture = active.current;
      if (!gesture?.moved || gesture.token !== token) return;
      gesture.last = point;
      if (released) void finish(false, point);
      else {
        gesture.next = point;
        void send(gesture).catch((error) => {
          latest.current.onError(error);
          cancel();
        });
      }
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      unsubscribePointer();
      window.removeEventListener('keydown', key, true);
      cancel();
    };
  }, [send, frame.interactionEpoch]);
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || latest.current.disabled || settling.current || active.current) return;
      event.preventDefault();
      event.currentTarget.focus();
      active.current = {
        origin: point(event),
        last: point(event),
        moved: false,
        token: crypto.randomUUID(),
        begun: false,
        pointerId: event.pointerId,
        target: event.currentTarget,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onClick(event: React.MouseEvent<HTMLElement>) {
      if (event.detail === 0 && !latest.current.disabled && !settling.current)
        void window.desktopPetals.drawer({ kind: 'toggle', reduced: reduced() }).catch(latest.current.onError);
    },
  };
}
