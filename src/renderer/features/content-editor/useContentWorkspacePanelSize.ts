import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Axis = 'width' | 'height';
const defaultSize = { width: 320, height: 256 };

function keyFor(key: string | undefined, axis: Axis) {
  return key ? `aiy.content-workspace.${key}.${axis}` : null;
}

function loadSize(key: string | undefined, panel: string | undefined) {
  const size = { ...defaultSize };
  try {
    for (const axis of ['width', 'height'] as const) {
      const keyName = keyFor(key, axis);
      const legacyKey = key && panel ? `aiy.content-workspace.${key}.${panel.toLowerCase()}.${axis}` : null;
      const stored =
        (keyName ? window.localStorage.getItem(keyName) : null) ??
        (legacyKey ? window.localStorage.getItem(legacyKey) : null);
      const value = Number(stored);
      if (stored !== null && Number.isFinite(value) && value > 0) size[axis] = value;
    }
  } catch {
    /* Sizing remains available without persistent storage. */
  }
  return size;
}

export function useContentWorkspacePanelSize({
  dockedAt,
  preferenceKey,
  selected,
  panelWidth,
  minimumWidth,
  maximumWidth,
  onPanelWidthChange,
}: {
  dockedAt: number;
  preferenceKey?: string;
  selected?: string;
  panelWidth?: number;
  minimumWidth: number;
  maximumWidth: number;
  onPanelWidthChange?(value: number): void;
}) {
  const asideRef = useRef<HTMLElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const initialPanel = useRef(selected);
  const [size, setSize] = useState(() => loadSize(preferenceKey, selected));
  const [drag, setDrag] = useState<{ axis: Axis; value: number } | null>(null);
  const [available, setAvailable] = useState({ width: 960, height: 640 });
  const compact = available.width < dockedAt;
  const maximumHeight = Math.max(0, available.height - Math.min(160, available.height * 0.4));
  const minimumHeight = Math.min(120, maximumHeight);
  const maxWidth = Math.max(minimumWidth, Math.min(maximumWidth, available.width - 480));
  const clamp = (axis: Axis, value: number) =>
    Math.round(
      Math.min(
        axis === 'width' ? maxWidth : maximumHeight,
        Math.max(axis === 'width' ? minimumWidth : minimumHeight, value),
      ),
    );
  const width = clamp('width', drag?.axis === 'width' ? drag.value : (panelWidth ?? size.width));
  const height = clamp('height', drag?.axis === 'height' ? drag.value : size.height);

  useEffect(() => {
    const restored = loadSize(preferenceKey, initialPanel.current);
    setSize(restored);
    try {
      // Persist the shared size so reopening on a different tab cannot revive its old dimensions.
      for (const axis of ['width', 'height'] as const) {
        const key = keyFor(preferenceKey, axis);
        if (key) window.localStorage.setItem(key, String(restored[axis]));
      }
    } catch {
      /* Sizing remains available without persistent storage. */
    }
  }, [preferenceKey]);

  useLayoutEffect(() => {
    const container = asideRef.current?.parentElement;
    if (!container) return;
    // clientWidth rounds fractional widths and can disagree with the CSS container query.
    const update = ({ width, height }: DOMRectReadOnly) => setAvailable({ width, height });
    update(container.getBoundingClientRect());
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cleanupRef.current?.(), [preferenceKey, available.width, available.height]);

  function change(axis: Axis, value: number) {
    const next = clamp(axis, value);
    if (axis === 'width' && onPanelWidthChange) onPanelWidthChange(next);
    else {
      setSize((current) => ({ ...current, [axis]: next }));
      try {
        const key = keyFor(preferenceKey, axis);
        if (key) window.localStorage.setItem(key, String(next));
      } catch {
        /* Keep the current size for this session. */
      }
    }
  }

  function beginResize(axis: Axis, event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    cleanupRef.current?.();
    const pointerId = event.pointerId;
    const origin = axis === 'width' ? event.clientX : event.clientY;
    const initial = axis === 'width' ? width : height;
    let current = initial;
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = axis === 'width' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      current = clamp(axis, initial - ((axis === 'width' ? pointer.clientX : pointer.clientY) - origin));
      setDrag({ axis, value: current });
    };
    const cleanup = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cleanup);
      setDrag(null);
      cleanupRef.current = null;
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      change(axis, current);
      cleanup();
    };
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId === pointerId) cleanup();
    };
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cleanup);
  }

  return {
    asideRef,
    available,
    resizing: drag !== null,
    compact,
    width,
    height,
    minimumHeight,
    maximumHeight,
    maximumWidth: maxWidth,
    change,
    beginResize,
  };
}
