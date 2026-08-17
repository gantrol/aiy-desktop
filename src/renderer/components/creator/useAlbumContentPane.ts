import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const storageKey = 'aiy.creator.albumContentsWidth.v1';
const minimumWidth = 208;
const maximumWidth = 360;
const defaultWidth = 240;
const minimumMainWidth = 240;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function initialWidth() {
  const stored = globalThis.localStorage?.getItem(storageKey);
  if (!stored) return defaultWidth;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clamp(parsed, minimumWidth, maximumWidth) : defaultWidth;
}

export function useAlbumContentPane() {
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);
  const [preferredWidth, setPreferredWidth] = useState(initialWidth);
  const resizeMaximum = Math.max(minimumWidth, Math.min(maximumWidth, layoutWidth - minimumMainWidth));
  const width = clamp(preferredWidth, minimumWidth, resizeMaximum);

  const setWidth = useCallback(
    (nextWidth: number) => {
      const next = clamp(nextWidth, minimumWidth, resizeMaximum);
      setPreferredWidth(next);
      globalThis.localStorage?.setItem(storageKey, String(next));
    },
    [resizeMaximum],
  );

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      activeResizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = width;
      const previousCursor = document.body.style.cursor;
      const previousSelection = document.body.style.userSelect;
      let active = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const move = (pointer: PointerEvent) => setWidth(startWidth + pointer.clientX - startX);
      const finish = () => {
        if (!active) return;
        active = false;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelection;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        window.removeEventListener('blur', finish);
        if (activeResizeCleanupRef.current === finish) activeResizeCleanupRef.current = null;
      };

      activeResizeCleanupRef.current = finish;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      window.addEventListener('blur', finish);
    },
    [setWidth, width],
  );

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return undefined;
    const update = () => setLayoutWidth(element.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => activeResizeCleanupRef.current?.(), []);

  return {
    layoutRef,
    width,
    minimumWidth,
    maximumWidth: resizeMaximum,
    setWidth,
    beginResize,
  };
}
