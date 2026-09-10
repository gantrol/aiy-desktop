import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

type Point = { x: number; y: number };

/** Reserve native menu space before opening; release it before invoking a menu action. */
export function usePetalMenu(enabled: boolean, onError: (error: unknown) => void) {
  const [anchor, setAnchor] = useState<Point | null>(null);
  const generation = useRef(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  // A close must finish after an in-flight open, including blur and unmount cleanup.
  const setNativeMenu = useCallback((open: boolean, point?: Point) => {
    const operation = pending.current.catch(() => undefined).then(() => window.desktopPetals.setMenuOpen(open, point));
    pending.current = operation;
    return operation;
  }, []);
  const invalidatePendingOpen = useCallback(() => ++generation.current, []);
  const close = useCallback(async () => {
    invalidatePendingOpen();
    setAnchor(null);
    await setNativeMenu(false);
  }, [invalidatePendingOpen, setNativeMenu]);
  const openAt = useCallback(
    (point?: Point) => {
      if (!enabled) return;
      const request = invalidatePendingOpen();
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void setNativeMenu(true, point)
        .then((position) => {
          if (request === generation.current) setAnchor(position);
        })
        .catch(onError);
    },
    [enabled, invalidatePendingOpen, onError, setNativeMenu],
  );

  useEffect(() => window.desktopPetals.onMenuRequested?.(() => openAt()), [openAt]);
  useEffect(() => {
    if (!enabled) void close().catch(onError);
  }, [enabled, close, onError]);
  useEffect(() => {
    const blur = () => {
      void close().catch(onError);
    };
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur);
      invalidatePendingOpen();
      void setNativeMenu(false).catch(() => undefined);
    };
  }, [close, invalidatePendingOpen, onError, setNativeMenu]);

  return {
    anchor,
    openAt,
    close,
    contextHandlers: {
      onContextMenu(event: MouseEvent<HTMLElement>) {
        if (!enabled) return;
        event.preventDefault();
        if ((event.target as Element).closest('[data-overlay-surface]')) return;
        (event.target as Element).closest<HTMLElement>('button, [tabindex]')?.focus({ preventScroll: true });
        openAt({ x: Math.round(event.screenX), y: Math.round(event.screenY) });
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (!enabled || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
        event.preventDefault();
        if ((event.target as Element).closest('[data-overlay-surface]')) return;
        const bounds = (event.target as HTMLElement).getBoundingClientRect();
        openAt({
          x: Math.round(window.screenX + bounds.left + bounds.width / 2),
          y: Math.round(window.screenY + bounds.top + bounds.height / 2),
        });
      },
    },
    dismiss: () => {
      void close().catch(onError);
    },
    select: (action: () => Promise<unknown>) => {
      void close().then(action).catch(onError);
    },
    restoreFocus: () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    },
  };
}
