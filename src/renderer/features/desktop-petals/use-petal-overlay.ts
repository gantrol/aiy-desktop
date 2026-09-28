import { useCallback, useEffect, useRef, useState } from 'react';
import { petalOverlayName, type PetalOverlayKind } from '@/shared/contracts/petal-overlay';
import { petalError } from '@/shared/petal-errors';

export interface PetalOverlaySurface {
  token: string;
  window: Window;
  container: HTMLElement;
}

declare global {
  interface Window {
    petalOverlayReady?: Promise<void>;
  }
}

function loaded(child: Window, url: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (!signal.aborted && !child.closed && child.location.href !== url) return;
      clearTimeout(timer);
      if (!child.closed) child.removeEventListener('load', finish);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(() => {
      if (!child.closed) child.removeEventListener('load', finish);
      signal.removeEventListener('abort', finish);
      reject(petalError('sourceUnavailable'));
    }, 8_000);
    child.addEventListener('load', finish);
    signal.addEventListener('abort', finish, { once: true });
    if (child.location.href === url && child.document.readyState === 'complete') finish();
  });
}

/** A same-origin child hosts a portal, preserving the owner's React state and IPC identity. */
export function usePetalOverlay(kind: PetalOverlayKind, onClosed?: () => void) {
  const [surface, setSurface] = useState<PetalOverlaySurface | null>(null);
  const current = useRef<{ token: string; window: Window; controller: AbortController } | null>(null);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  const close = useCallback(() => {
    const previous = current.current;
    current.current = null;
    previous?.controller.abort();
    setSurface(null);
    if (previous && !previous.window.closed) previous.window.close();
  }, []);
  const open = useCallback(
    async (point?: { x: number; y: number; top?: number }) => {
      close();
      const token = crypto.randomUUID();
      const url = new URL('petal-overlay.html', window.location.href).href;
      const child = window.open(
        url,
        petalOverlayName(kind, token),
        point
          ? `popup,left=${Math.round(point.x)},top=${Math.round(point.y)},anchorTop=${Math.round(point.top ?? point.y)}`
          : 'popup',
      );
      if (!child) throw petalError('sourceUnavailable');
      const controller = new AbortController();
      current.current = { token, window: child, controller };
      try {
        await loaded(child, url, controller.signal);
        if (current.current?.token !== token || child.closed) return null;
        if (!child.petalOverlayReady) throw petalError('sourceUnavailable');
        await child.petalOverlayReady;
        if (current.current?.token !== token || child.closed) return null;
        child.document.documentElement.lang = document.documentElement.lang;
        child.document.documentElement.className = document.documentElement.className;
        const container = child.document.getElementById('root');
        if (!container) throw petalError('sourceUnavailable');
        const next = { token, window: child, container };
        setSurface(next);
        return next;
      } catch (error) {
        if (current.current?.token !== token) return null;
        close();
        throw error;
      }
    },
    [close, kind],
  );
  useEffect(() => {
    const onOverlayClosed = window.desktopPetals.onOverlayClosed;
    if (typeof onOverlayClosed !== 'function') return;
    const unsubscribe = onOverlayClosed((token) => {
      if (current.current?.token !== token) return;
      close();
      closed.current?.();
    });
    return () => {
      unsubscribe();
      close();
    };
  }, [close]);
  return { surface, open, close };
}
