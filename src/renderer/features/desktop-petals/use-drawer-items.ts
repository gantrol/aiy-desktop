import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { PetalDrawerFrame, PetalDrawerItem } from '@/shared/contracts/petal-drawer';
import { DRAWER_ROW } from '@/renderer/features/desktop-petals/use-drawer-scroll';
import { PETAL_DRAWER, PETAL_DRAWER_COLUMN } from '@/shared/contracts/petal-drawer';

type Point = { x: number; y: number };
const position = (event: { screenX: number; screenY: number }): Point => ({
  x: Math.round(event.screenX),
  y: Math.round(event.screenY),
});
export function useDrawerItems(
  viewport: RefObject<HTMLDivElement | null>,
  items: PetalDrawerItem[],
  frame: PetalDrawerFrame,
  step: (amount: number) => void,
  manualAt: RefObject<number>,
  onOpen: (id: string) => void,
  onError: (error: unknown) => void,
  disabled: boolean,
) {
  const latest = useRef({ items, frame, step, manualAt, onOpen, onError, disabled });
  latest.current = { items, frame, step, manualAt, onOpen, onError, disabled };
  const gesture = useRef<{
    id: string;
    item: PetalDrawerItem;
    token: string;
    pointerId: number;
    target: HTMLElement;
    origin: Point;
    last: Point;
    moved: boolean;
    scroll: number;
    begin?: Promise<void>;
  } | null>(null);
  const [preview, setPreview] = useState<{ id: string; item: PetalDrawerItem; point: Point } | null>(null);
  const [beforeId, setBeforeId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const settling = useRef(false);
  const before = useRef<string | null | undefined>(undefined);
  const target = useCallback(
    (point: Point, moving = gesture.current?.id) => {
      const element = viewport.current;
      if (!element) return undefined;
      const rect = element.getBoundingClientRect(),
        x = point.x - window.screenX - rect.left,
        y = point.y - window.screenY - rect.top;
      if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return undefined;
      const data = latest.current,
        row = Math.floor((y + element.scrollTop - PETAL_DRAWER.gridTop) / DRAWER_ROW);
      const top = PETAL_DRAWER.gridTop + row * DRAWER_ROW - element.scrollTop;
      if (row < 0 || top < 0 || top + PETAL_DRAWER.cellHeight > rect.height) return undefined;
      const column = Math.max(
        0,
        Math.min(data.frame.columns - 1, Math.floor((x - PETAL_DRAWER.padding) / PETAL_DRAWER_COLUMN)),
      );
      let index = row * data.frame.columns + column;
      if (x - PETAL_DRAWER.padding - column * PETAL_DRAWER_COLUMN >= PETAL_DRAWER.cellWidth / 2) index++;
      while (data.items[index]?.id === moving) index++;
      return data.items[index]?.id ?? null;
    },
    [viewport],
  );
  const updateTarget = useCallback(
    (point: Point) => {
      const next = target(point);
      if (next !== before.current) {
        before.current = next;
        setBeforeId(next);
      }
      return next;
    },
    [target],
  );
  useEffect(() => {
    const finish = async (cancel: boolean, point?: Point) => {
      const active = gesture.current;
      if (!active) return;
      gesture.current = null;
      settling.current = true;
      setBusy(true);
      if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
      try {
        if (!active.moved) {
          if (!cancel) latest.current.onOpen(active.id);
          return;
        }
        await active.begin;
        const destination = point ?? active.last;
        if (cancel) {
          if (viewport.current) viewport.current.scrollTop = active.scroll;
          return;
        }
        const next = target(destination, active.id);
        if (next !== undefined) await window.desktopPetals.drawer({ kind: 'reorder', id: active.id, beforeId: next });
        else {
          const f = latest.current.frame,
            x = destination.x - f.x - f.canvasX - f.handleX,
            y = destination.y - f.y - f.canvasY - f.handleY;
          // The drawer's handle and clipped overflow are not desktop drop targets.
          if (x >= 0 && x < PETAL_DRAWER.handle && y >= 0 && y < PETAL_DRAWER.handleHeight) return;
          await window.desktopPetals.drawer({ kind: 'take', id: active.id, point: destination });
        }
      } catch (error) {
        if (viewport.current) viewport.current.scrollTop = active.scroll;
        latest.current.onError(error);
      } finally {
        if (active.moved)
          await window.desktopPetals.drawer({ kind: 'dragging', active: false }).catch(latest.current.onError);
        settling.current = false;
        setBusy(false);
        setPreview(null);
        setBeforeId(undefined);
        before.current = undefined;
      }
    };
    const move = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active || event.pointerId !== active.pointerId) return;
      active.last = position(event);
      // Resizing a transparent native window can produce zero-button moves.
      // Only pointerup or the native release signal may complete a drag.
      if (!active.moved && !(event.buttons & 1)) return;
      if (!active.moved && Math.hypot(active.last.x - active.origin.x, active.last.y - active.origin.y) < 6) return;
      if (!active.moved) {
        active.moved = true;
        active.begin = window.desktopPetals.drawer({ kind: 'dragging', active: true, token: active.token });
        void active.begin.catch((error) => {
          latest.current.onError(error);
          void finish(true);
        });
      }
      setPreview({ id: active.id, item: active.item, point: active.last });
      updateTarget(active.last);
    };
    const up = (event: PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) void finish(false, position(event));
    };
    const cancel = () => {
      void finish(true);
    };
    const pointerCancel = () => {
      if (!gesture.current?.moved) cancel();
    };
    const unsubscribePointer = window.desktopPetals.onDrawerPointer(({ token, point, released }) => {
      const active = gesture.current;
      if (!active?.moved || active.token !== token) return;
      active.last = point;
      if (released) void finish(false, point);
      else {
        setPreview({ id: active.id, item: active.item, point });
        updateTarget(point);
      }
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      unsubscribePointer();
      window.removeEventListener('keydown', escape, true);
      cancel();
    };
  }, [viewport, target, updateTarget, frame.interactionEpoch]);
  const external = frame.dropPoint;
  useEffect(() => {
    if (!external) return;
    const next = updateTarget(external);
    void window.desktopPetals.drawer({ kind: 'drop-target', beforeId: next }).catch(latest.current.onError);
  }, [external, frame.canvasX, frame.canvasY, frame.columns, updateTarget]);
  const hasDrag = Boolean(preview || external);
  useEffect(() => {
    if (!hasDrag) return;
    let direction = 0,
      since = Date.now();
    const timer = setInterval(() => {
      const point = gesture.current?.last ?? latest.current.frame.dropPoint,
        element = viewport.current;
      if (!point || !element) return;
      const rect = element.getBoundingClientRect(),
        x = point.x - window.screenX - rect.left,
        y = point.y - window.screenY - rect.top;
      const next =
        x >= 0 && x < rect.width && y >= 0 && y < rect.height ? (y < 12 ? -1 : y > rect.height - 12 ? 1 : 0) : 0;
      if (next !== direction || Date.now() - latest.current.manualAt.current < 300) {
        since = Date.now();
        direction = next;
      }
      if (direction && Date.now() - since >= 300) {
        latest.current.step(direction);
        since = Date.now();
        const nextId = updateTarget(point);
        if (latest.current.frame.dropPoint)
          void window.desktopPetals.drawer({ kind: 'drop-target', beforeId: nextId }).catch(latest.current.onError);
      }
    }, 60);
    return () => clearInterval(timer);
  }, [hasDrag, viewport, updateTarget]);
  return {
    preview,
    beforeId: hasDrag ? beforeId : undefined,
    busy,
    handlers(id: string) {
      return {
        onPointerDown(event: ReactPointerEvent<HTMLElement>) {
          if (event.button !== 0 || latest.current.disabled || settling.current || gesture.current) return;
          const item = latest.current.items.find((candidate) => candidate.id === id);
          if (!item) return;
          event.preventDefault();
          event.currentTarget.focus();
          gesture.current = {
            id,
            item,
            token: crypto.randomUUID(),
            pointerId: event.pointerId,
            target: event.currentTarget,
            origin: position(event),
            last: position(event),
            moved: false,
            scroll: viewport.current?.scrollTop ?? 0,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onClick(event: React.MouseEvent<HTMLElement>) {
          if (event.detail === 0 && !settling.current && !latest.current.disabled) latest.current.onOpen(id);
        },
        onDragStart(event: React.DragEvent<HTMLElement>) {
          event.preventDefault();
        },
      };
    },
  };
}
