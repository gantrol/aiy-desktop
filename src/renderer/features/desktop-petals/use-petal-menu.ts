import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { usePetalOverlay } from '@/renderer/features/desktop-petals/use-petal-overlay';

type Point = { x: number; y: number };

/** Menu DOM lives in its own window; actions retain the originating widget's context. */
export function usePetalMenu(enabled: boolean, onError: (error: unknown) => void) {
  const [anchor, setAnchor] = useState<Point | null>(null);
  const generation = useRef(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const overlay = usePetalOverlay('menu', () => void close().catch(onError));
  const { open: openOverlay, close: closeOverlay } = overlay;
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
    closeOverlay();
    await setNativeMenu(false);
  }, [closeOverlay, invalidatePendingOpen, setNativeMenu]);
  const openAt = useCallback(
    (point?: Point) => {
      if (!enabled) return;
      const request = invalidatePendingOpen();
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void setNativeMenu(true, point)
        .then(async (position) => {
          if (request !== generation.current) return;
          const surface = await openOverlay(position);
          if (surface && request === generation.current)
            setAnchor({ x: position.x - surface.window.screenX, y: position.y - surface.window.screenY });
        })
        .catch((error) => {
          void close().catch(onError);
          onError(error);
        });
    },
    [close, enabled, invalidatePendingOpen, onError, openOverlay, setNativeMenu],
  );

  useEffect(() => window.desktopPetals.onMenuRequested?.(() => openAt()), [openAt]);
  useEffect(() => {
    if (!enabled) void close().catch(onError);
  }, [enabled, close, onError]);
  useEffect(() => {
    return () => {
      invalidatePendingOpen();
      void setNativeMenu(false).catch(() => undefined);
    };
  }, [invalidatePendingOpen, setNativeMenu]);

  return {
    anchor,
    surface: overlay.surface,
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
      void close()
        .then(() => {
          if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
        })
        .catch(onError);
    },
    select: <Args extends unknown[]>(action: (...args: Args) => Promise<unknown>, ...args: Args) => {
      void close()
        .then(() => action(...args))
        .catch(onError);
    },
    restoreFocus: () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    },
  };
}
