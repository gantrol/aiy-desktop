import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PetalDrawerItem } from '@/shared/contracts/petal-drawer';
import { PETAL_DRAWER_ROW } from '@/shared/contracts/petal-drawer';

export const DRAWER_ROW = PETAL_DRAWER_ROW;
export function useDrawerScroll(
  viewport: RefObject<HTMLDivElement | null>,
  items: PetalDrawerItem[],
  columns: number,
  rows: number,
  anchorId: string | null,
  enabled: boolean,
  onError: (error: unknown) => void,
) {
  const [top, setTop] = useState(0);
  const latest = useRef({ items, columns, rows, enabled, onError });
  latest.current = { items, columns, rows, enabled, onError };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef<string | null>(anchorId);
  const incomingAnchor = useRef(anchorId);
  const currentAnchor = useRef(anchorId);
  const manualAt = useRef(0);
  const ids = items.map((item) => item.id).join('|');
  const save = useCallback(() => {
    const id = currentAnchor.current;
    if (id === lastSaved.current) return;
    const previous = lastSaved.current;
    lastSaved.current = id;
    void window.desktopPetals.drawer({ kind: 'anchor', id }).catch((error) => {
      if (lastSaved.current === id) lastSaved.current = previous;
      latest.current.onError(error);
    });
  }, []);
  useEffect(() => {
    if (incomingAnchor.current !== anchorId) {
      incomingAnchor.current = anchorId;
      currentAnchor.current = anchorId;
      lastSaved.current = anchorId;
    }
    const element = viewport.current;
    if (!element) return;
    const index = latest.current.items.findIndex((item) => item.id === currentAnchor.current);
    if (index >= 0) element.scrollTop = Math.floor(index / columns) * DRAWER_ROW;
    else
      element.scrollTop = Math.min(
        element.scrollTop,
        Math.max(0, Math.ceil(latest.current.items.length / columns) - rows) * DRAWER_ROW,
      );
    setTop(element.scrollTop);
  }, [anchorId, columns, rows, ids, viewport, enabled]);
  const step = useCallback(
    (amount: number) => {
      const element = viewport.current;
      if (!element) return;
      element.scrollTop = Math.round(element.scrollTop / DRAWER_ROW) * DRAWER_ROW + amount * DRAWER_ROW;
    },
    [viewport],
  );
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!latest.current.enabled) {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey) return;
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      manualAt.current = Date.now();
      if (event.deltaMode !== 0 || Math.abs(event.deltaY) >= 80) step(Math.sign(event.deltaY));
      else element.scrollTop += event.deltaY;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
    };
  }, [step, viewport, enabled]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onScroll = () => {
    const element = viewport.current;
    if (!element) return;
    setTop(element.scrollTop);
    currentAnchor.current =
      latest.current.items[Math.round(element.scrollTop / DRAWER_ROW) * latest.current.columns]?.id ?? null;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const target = Math.round(element.scrollTop / DRAWER_ROW) * DRAWER_ROW;
      if (element.isConnected && Math.abs(element.scrollTop - target) > 0.5) element.scrollTop = target;
      save();
    }, 140);
  };
  const reveal = (index: number) => {
    const element = viewport.current;
    if (!element) return;
    const row = Math.floor(index / columns),
      first = Math.round(element.scrollTop / DRAWER_ROW);
    if (row < first) element.scrollTop = row * DRAWER_ROW;
    else if (row >= first + rows) element.scrollTop = (row - rows + 1) * DRAWER_ROW;
    setTop(element.scrollTop);
  };
  return { top, onScroll, reveal, step, manualAt };
}
