import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const preferredMinimumSplitPaneWidth = 320;

function splitBounds(containerWidth: number) {
  const minimum = Math.min(preferredMinimumSplitPaneWidth, containerWidth / 2);
  return { minimum, maximum: Math.max(minimum, containerWidth - minimum) };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function useArticleEditorSplitPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [primaryRatio, setPrimaryRatio] = useState(0.5);
  const { minimum, maximum } = splitBounds(containerWidth);
  const primaryWidth = containerWidth ? clamp(containerWidth * primaryRatio, minimum, maximum) : 0;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setContainerWidth(container.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

  const setPrimaryWidth = useCallback(
    (width: number) => {
      if (!containerWidth) return;
      const bounds = splitBounds(containerWidth);
      setPrimaryRatio(clamp(width, bounds.minimum, bounds.maximum) / containerWidth);
    },
    [containerWidth],
  );

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      cleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = primaryWidth;
      const previousCursor = document.body.style.cursor;
      const previousSelection = document.body.style.userSelect;
      let active = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const move = (pointer: PointerEvent) => setPrimaryWidth(startWidth + pointer.clientX - startX);
      const finish = () => {
        if (!active) return;
        active = false;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelection;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        window.removeEventListener('blur', finish);
        if (cleanupRef.current === finish) cleanupRef.current = null;
      };

      cleanupRef.current = finish;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      window.addEventListener('blur', finish);
    },
    [primaryWidth, setPrimaryWidth],
  );

  return {
    beginResize,
    containerRef,
    maximum,
    minimum,
    primaryWidth,
    setPrimaryWidth,
  };
}
