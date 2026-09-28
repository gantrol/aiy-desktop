import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useWorkbenchScopeKey } from '@/renderer/components/workbench/WorkbenchScope';
import { beginPanePointerDrag, createPaneResizeGesture } from '@/renderer/components/workbench/paneResize';

interface LayoutPreference {
  expanded: boolean;
  width: number;
}
function loadPreference(key: string, width: number): LayoutPreference {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<LayoutPreference> | null;
    return {
      expanded: stored?.expanded !== false,
      width:
        typeof stored?.width === 'number' && Number.isFinite(stored.width)
          ? Math.max(200, Math.min(640, stored.width))
          : width,
    };
  } catch {
    return { expanded: true, width };
  }
}

export function useWorkbenchLayout(
  layoutKey: string,
  initialWidth: number,
  minimumDetailWidth: number,
  measureParent = false,
) {
  const key = `aiy.workbench.v1:${useWorkbenchScopeKey(layoutKey)}`;
  const root = useRef<HTMLDivElement>(null);
  const [preference, setPreference] = useState(() => loadPreference(key, initialWidth));
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<LayoutPreference | null>(null);
  const displayed = preview ?? preference;
  const resizing = preview !== null;
  const cleanupDrag = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    cleanupDrag.current?.();
    setPreference(loadPreference(key, initialWidth));
  }, [key, initialWidth]);
  // A hidden tab reports zero width. Keep its last usable geometry until it is visible again.
  useLayoutEffect(() => {
    const element = measureParent ? root.current?.parentElement : root.current;
    if (!element) return;
    const update = (next: number) => {
      setVisible(next > 0);
      if (next > 0) setWidth(next);
      else cleanupDrag.current?.();
    };
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureParent]);
  useEffect(() => () => cleanupDrag.current?.(), []);
  const updatePreference = useCallback(
    (next: LayoutPreference) => {
      setPreference(next);
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Layout remains usable without storage. */
      }
    },
    [key],
  );
  const wide = width >= initialWidth + minimumDetailWidth;
  const maximumWidth = Math.max(200, Math.min(640, width - minimumDetailWidth));
  const collectionWidth = Math.min(displayed.width, maximumWidth);
  const resize = (next: number) => {
    if (!Number.isFinite(next)) return;
    cleanupDrag.current?.();
    if (!displayed.expanded) {
      if (next > 0) updatePreference({ ...preference, expanded: true });
    } else if (next < 200) updatePreference({ ...preference, expanded: false });
    else updatePreference({ ...preference, expanded: true, width: Math.min(maximumWidth, next) });
  };
  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || !wide) return;
    cleanupDrag.current?.();
    let candidate = preference;
    let active = true;
    let removeListeners: (() => void) | null = null;
    const gesture = createPaneResizeGesture(
      { collapsed: !preference.expanded, width: Math.min(preference.width, maximumWidth) },
      { minimum: 200, maximum: maximumWidth, collapsedWidth: 0 },
    );
    const finish = (cancelled: boolean) => {
      if (!active) return;
      active = false;
      removeListeners?.();
      cleanupDrag.current = null;
      setPreview(null);
      // Only a completed gesture changes the saved layout. Cancelling discards the preview.
      if (!cancelled) updatePreference(candidate);
    };
    setPreview(preference);
    removeListeners = beginPanePointerDrag(
      event,
      (delta) => {
        const next = gesture(delta);
        candidate = { expanded: !next.collapsed, width: next.width };
        setPreview(candidate);
      },
      finish,
    );
    cleanupDrag.current = () => finish(true);
  };
  // A gesture cannot continue with bounds captured from another container geometry.
  useLayoutEffect(() => {
    cleanupDrag.current?.();
  }, [wide, maximumWidth, measureParent]);
  return {
    root,
    scopeKey: key,
    visible,
    wide,
    resizing,
    expanded: displayed.expanded,
    collectionWidth,
    maximumWidth,
    resize,
    beginResize,
    setExpanded: (expanded: boolean) => {
      cleanupDrag.current?.();
      updatePreference({ ...preference, expanded });
    },
  };
}
