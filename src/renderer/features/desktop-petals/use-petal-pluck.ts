import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { PETAL_SHAPE_ANCHOR } from '@/renderer/features/desktop-petals/petal-shape-layout';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { containsFlowerPoint, flowerPetalAnchor, isPluckableFlowerPetal } from '@/shared/flower-geometry';
import { tracePetalGeometry } from '@/renderer/features/desktop-petals/petal-geometry-diagnostics';

type Point = { x: number; y: number };
interface Gesture {
  token: string;
  nativeWatch: Promise<boolean>;
  index: number;
  pointerId: number;
  target: SVGGElement;
  origin: Point;
  last: Point;
  center: Point;
  petal: Point;
  grab: Point;
  preview: boolean;
  detached: boolean;
  cancelled: boolean;
  committed: boolean;
  controller: AbortController;
}
interface Pull {
  index: number;
  x: number;
  y: number;
  pointerX: number;
  pointerY: number;
  detached: number;
  phase: 'pulling' | 'settling' | 'returning';
}
const PLUCK_DISTANCE = 48;
const release = (active: Gesture) => {
  if (active.pointerId >= 0) void window.desktopPetals.pluckWatch(active.token, false).catch(() => undefined);
  if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
};
function pause(active: Gesture, duration: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      active.controller.signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, duration);
    active.controller.signal.addEventListener('abort', done, { once: true });
    if (active.controller.signal.aborted) done();
  });
}
const motionDuration = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);

function projectPull(size: number, active: Gesture, delta: Point, phase: Pull['phase'], detached?: number): Pull {
  return {
    index: active.index,
    x: (delta.x * 200) / size,
    y: (delta.y * 200) / size,
    pointerX: size / 2 + active.grab.x + delta.x - active.center.x,
    pointerY: size / 2 + active.grab.y + delta.y - active.center.y,
    detached:
      detached ??
      (active.detached ? 1 : Math.min(1, Math.max(0, (Math.hypot(delta.x, delta.y) - 12) / (PLUCK_DISTANCE - 12)))),
    phase,
  };
}

function beginGesture(
  flower: HTMLDivElement,
  index: number,
  target: SVGGElement,
  origin: Point,
  pointerId: number,
): Gesture {
  const bounds = flower.getBoundingClientRect();
  const petal = flowerPetalAnchor(index);
  const petalCenter = {
    x: window.screenX + bounds.left + (petal[0] * bounds.width) / 200,
    y: window.screenY + bounds.top + (petal[1] * bounds.height) / 200,
  };
  return {
    token: crypto.randomUUID(),
    nativeWatch: Promise.resolve(false),
    index,
    target,
    origin,
    last: origin,
    pointerId,
    center: { x: window.screenX + bounds.left + bounds.width / 2, y: window.screenY + bounds.top + bounds.height / 2 },
    petal: petalCenter,
    grab: pointerId < 0 ? petalCenter : origin,
    preview: false,
    detached: false,
    cancelled: false,
    committed: false,
    controller: new AbortController(),
  };
}

/** Pull, morph, hand off after native paint, then regrow; cancellation reverses the same visual. */
export function usePetalPluck(
  onPluck: (point?: Point, dragged?: boolean) => Promise<boolean>,
  size: number,
  onPreview: (active: boolean) => Promise<void>,
  onError?: (reason: unknown) => void,
) {
  const flower = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const operation = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const preview = useRef(Promise.resolve());
  const [pull, setPull] = useState<Pull | null>(null);
  const [growing, setGrowing] = useState<number[]>([]);
  const showPreview = useStableCallback((active: boolean) => {
    preview.current = preview.current.catch(() => undefined).then(() => onPreview(active));
    return preview.current;
  });
  const ensurePreview = (active: Gesture) => {
    if (active.preview) return preview.current;
    active.preview = true;
    return showPreview(true);
  };
  const clearFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const project = (active: Gesture, delta: Point, phase: Pull['phase'], detached?: number) =>
    projectPull(size, active, delta, phase, detached);
  const restore = async (active: Gesture) => {
    if (!active.controller.signal.aborted && active.preview) {
      setPull(project(active, { x: 0, y: 0 }, 'returning', 0));
      await pause(active, motionDuration());
    }
  };
  const cleanup = async (active: Gesture) => {
    tracePetalGeometry('pluck-cleanup', { cancelled: active.cancelled, committed: active.committed });
    if (!active.controller.signal.aborted) setPull(null);
    if (active.preview) await showPreview(false).catch(() => undefined);
    if (operation.current === active) operation.current = null;
  };
  const cancel = useStableCallback(() => {
    const active = gesture.current;
    if (!active) {
      if (operation.current && !operation.current.committed) operation.current.cancelled = true;
      return;
    }
    gesture.current = null;
    operation.current = active;
    clearFrame();
    release(active);
    void restore(active).finally(() => cleanup(active));
  });
  const request = async (active: Gesture, delta?: Point, pointer?: Point) => {
    const dragged = Boolean(delta);
    operation.current = active;
    try {
      await ensurePreview(active);
      tracePetalGeometry('pluck-preview-ack', { origin: active.origin, petal: active.petal, delta });
      if (active.controller.signal.aborted) return;
      if (active.cancelled) return await restore(active);
      if (!delta) {
        setPull(project(active, { x: 0, y: 0 }, 'settling', 0));
        // Give the expanded preview and starting pose a frame before click-to-pluck motion.
        await pause(active, 32);
        const dx = active.petal.x - active.center.x,
          dy = active.petal.y - active.center.y;
        const length = Math.hypot(dx, dy) || 1;
        delta = { x: (dx / length) * 76, y: (dy / length) * 76 };
      }
      if (active.controller.signal.aborted) return;
      if (active.cancelled) return await restore(active);
      // Settle inside the release display, including staggered or negative-coordinate layouts.
      const position = await window.desktopPetals.pluckPosition(
        {
          x: Math.round(active.grab.x + delta.x - PETAL_SHAPE_ANCHOR.x),
          y: Math.round(active.grab.y + delta.y - PETAL_SHAPE_ANCHOR.y),
        },
        pointer ? { x: Math.round(pointer.x), y: Math.round(pointer.y) } : undefined,
      );
      if (active.controller.signal.aborted) return;
      if (active.cancelled) return await restore(active);
      const center = { x: position.x + PETAL_SHAPE_ANCHOR.x, y: position.y + PETAL_SHAPE_ANCHOR.y };
      setPull(project(active, { x: center.x - active.grab.x, y: center.y - active.grab.y }, 'settling', 1));
      tracePetalGeometry('pluck-settle', { center, delta });
      await pause(active, motionDuration());
      if (active.controller.signal.aborted) return;
      if (active.cancelled) return await restore(active);
      active.committed = true;
      const created = await onPluck(position, dragged);
      tracePetalGeometry('pluck-created', { created, center });
      if (active.controller.signal.aborted) return;
      if (created) {
        setGrowing((items) => [...items.filter((index) => index !== active.index), active.index]);
        // Let the ready native window take over before removing its identical preview.
        await pause(active, 48);
      } else await restore(active);
    } catch (reason) {
      if (!active.controller.signal.aborted) onError?.(reason);
      await restore(active);
    } finally {
      await cleanup(active);
    }
  };
  const finish = useStableCallback((destination: Point, released = true) => {
    const active = gesture.current;
    if (!active) return;
    const delta = { x: destination.x - active.origin.x, y: destination.y - active.origin.y };
    const distance = Math.hypot(delta.x, delta.y);
    const clicked = released && distance < 6 && !active.preview;
    const detached = active.detached || distance >= PLUCK_DISTANCE;
    tracePetalGeometry('pluck-release', {
      destination,
      origin: active.origin,
      flowerCenter: active.center,
      released,
      distance,
      detached,
      clicked,
      insideFlower: containsFlowerPoint(destination, active.center, size),
    });
    // Only a release over the painted flower returns a detached petal. A
    // transparent gap or window padding must not swallow a completed pull.
    if ((detached && !containsFlowerPoint(destination, active.center, size)) || clicked) {
      gesture.current = null;
      operation.current = active;
      clearFrame();
      release(active);
      void request(active, clicked ? undefined : delta, clicked ? undefined : destination);
    } else cancel();
  });
  const movePoint = useStableCallback((point: Point) => {
    const active = gesture.current;
    if (!active) return;
    active.last = point;
    const delta = { x: active.last.x - active.origin.x, y: active.last.y - active.origin.y };
    if (Math.hypot(delta.x, delta.y) >= PLUCK_DISTANCE) active.detached = true;
    if (Math.hypot(delta.x, delta.y) < 6 && !active.preview) return;
    if (!active.preview) {
      void ensurePreview(active).catch((reason) => {
        if (gesture.current === active) {
          onError?.(reason);
          cancel();
        }
      });
    }
    clearFrame();
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (gesture.current === active) setPull(project(active, delta, 'pulling'));
    });
  });
  const move = useStableCallback((event: globalThis.PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = { x: event.screenX, y: event.screenY };
    if (!(event.buttons & 1)) return finish(point, true);
    movePoint(point);
  });
  useEffect(() => {
    const unsubscribe = window.desktopPetals.onPluckPointer((event) => {
      if (gesture.current?.token !== event.token) return;
      if (event.cancelled) cancel();
      else if (event.released) finish(event.point);
      else movePoint(event.point);
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    const up = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) finish({ x: event.screenX, y: event.screenY });
    };
    const abort = (event: globalThis.PointerEvent) => {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      void active.nativeWatch.then((watched) => {
        if (!watched && gesture.current === active) cancel();
      });
    };
    // Expanding the native preview can blur the window or release capture
    // while the button is still held. Neither event completes the gesture.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', abort, true);
    window.addEventListener('keydown', key);
    return () => {
      unsubscribe();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', abort, true);
      window.removeEventListener('keydown', key);
      const active = gesture.current ?? operation.current;
      gesture.current = null;
      operation.current = null;
      clearFrame();
      if (active) {
        active.controller.abort();
        release(active);
        if (active.preview) void showPreview(false).catch(() => undefined);
      }
    };
  }, [cancel, finish, move, movePoint, showPreview]);
  const events = (index: number) => ({
    onPointerDown(event: PointerEvent<SVGGElement>) {
      if (
        !isPluckableFlowerPetal(index) ||
        event.button !== 0 ||
        !event.isPrimary ||
        operation.current ||
        gesture.current
      )
        return;
      event.preventDefault();
      const active = beginGesture(
        flower.current!,
        index,
        event.currentTarget,
        { x: event.screenX, y: event.screenY },
        event.pointerId,
      );
      tracePetalGeometry('pluck-begin', {
        index,
        origin: active.origin,
        petal: active.petal,
        flowerCenter: active.center,
      });
      gesture.current = active;
      if (event.pointerType === 'mouse')
        active.nativeWatch = window.desktopPetals.pluckWatch(active.token, true).catch(() => false);
      try {
        active.target.setPointerCapture(active.pointerId);
      } catch (reason) {
        void active.nativeWatch.then((watched) => {
          if (!watched && gesture.current === active) {
            cancel();
            onError?.(reason);
          }
        });
      }
    },
    onKeyDown(event: React.KeyboardEvent<SVGGElement>) {
      if (!isPluckableFlowerPetal(index)) return;
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && !operation.current && !gesture.current) {
        event.preventDefault();
        const active = beginGesture(flower.current!, index, event.currentTarget, { x: 0, y: 0 }, -1);
        void request(active);
      }
    },
  });
  return {
    flower,
    pull,
    growing,
    events,
    finishGrowing: (index: number) => setGrowing((items) => items.filter((item) => item !== index)),
  };
}
