import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PetalOverlaySurface } from '@/renderer/features/desktop-petals/use-petal-overlay';

export function PetalOverlay({
  surface,
  point,
  fitHeight = false,
  children,
}: {
  surface: PetalOverlaySurface | null;
  point?: { x: number; y: number };
  fitHeight?: boolean;
  children: ReactNode;
}) {
  const x = point?.x,
    y = point?.y;
  useEffect(() => {
    if (!surface) return;
    const height = fitHeight
      ? Math.min(
          200,
          Math.max(1, Math.ceil(surface.container.firstElementChild?.getBoundingClientRect().height ?? 200)),
        )
      : undefined;
    void window.desktopPetals
      .overlayReady({ token: surface.token, point: x === undefined || y === undefined ? undefined : { x, y }, height })
      .catch((error) => {
        console.error('[desktop-petals] overlay presentation failed', error);
        surface.window.close();
      });
  }, [fitHeight, surface, x, y]);
  return surface ? createPortal(children, surface.container) : null;
}
