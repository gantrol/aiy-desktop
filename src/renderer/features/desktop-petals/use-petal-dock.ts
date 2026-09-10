import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { tracePetalGeometry } from '@/renderer/features/desktop-petals/petal-geometry-diagnostics';
import { useRoseFold } from '@/renderer/features/desktop-petals/use-rose-fold';
import { FLOWER_MOTION } from '@/shared/flower-geometry';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export function usePetalDock(snapshot: DesktopPetalSnapshot, onError: (reason: unknown) => void) {
  const { fold, animate, jump } = useRoseFold(snapshot.dock?.collapsed ? 1 : 0);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [anchor, setAnchor] = useState(snapshot.flowerAnchor);
  const previewAnchor = useRef<{ x: number; y: number } | null>(null);
  const setPluckPreview = useStableCallback(async (active: boolean) => {
    // Hold the painted screen position before native resizing can emit resize.
    if (active) previewAnchor.current ??= { x: window.screenX + anchor.x, y: window.screenY + anchor.y };
    try {
      await window.desktopPetals.pluckPreview(active);
    } catch (reason) {
      previewAnchor.current = null;
      throw reason;
    }
    if (!active) previewAnchor.current = null;
  });
  const [petalBounds, setPetalBounds] = useState(snapshot.dock?.petalBounds);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasCollapsed = useRef(snapshot.dock?.collapsed ?? false);
  const revision = useRef(0);
  // Temporary space belongs to the active pluck or menu until its handoff ends.
  const canCollapse = snapshot.hubView === 'flower' && snapshot.dock?.collapsed === false && !snapshot.flowerPreview;
  const cancel = useCallback(() => {
    revision.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!latest.current.dock?.collapsed) animate(0);
  }, [animate]);
  useLayoutEffect(() => {
    const update = (event?: Event) => {
      // Windows can round a 224 DIP window to a 226 CSS-pixel viewport at 125%.
      // Geometry intent, not an exact size comparison, owns desktop anchoring.
      const screenAnchor =
        previewAnchor.current ??
        (snapshot.flowerPreview
          ? { x: snapshot.point.x + snapshot.flowerAnchor.x, y: snapshot.point.y + snapshot.flowerAnchor.y }
          : null);
      const nextAnchor = screenAnchor
        ? {
            x: screenAnchor.x - window.screenX,
            y: screenAnchor.y - window.screenY,
          }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      tracePetalGeometry('dock-anchor-compute', {
        trigger: event?.type ?? 'snapshot-effect',
        snapshot: { point: snapshot.point, anchor: snapshot.flowerAnchor, preview: snapshot.flowerPreview },
        nextAnchor,
      });
      setAnchor(nextAnchor);
      const bounds = snapshot.dock?.petalBounds;
      setPetalBounds(
        bounds
          ? {
              ...bounds,
              x: snapshot.point.x + bounds.x - window.screenX,
              y: snapshot.point.y + bounds.y - window.screenY,
            }
          : undefined,
      );
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [
    snapshot.point.x,
    snapshot.point.y,
    snapshot.flowerAnchor.x,
    snapshot.flowerAnchor.y,
    snapshot.flowerPreview,
    snapshot.dock?.petalBounds,
    snapshot.flowerAnchor,
    snapshot.point,
  ]);
  useLayoutEffect(() => {
    tracePetalGeometry('dock-anchor-commit', {
      anchor,
      snapshot: { point: snapshot.point, anchor: snapshot.flowerAnchor, preview: snapshot.flowerPreview },
    });
  }, [anchor, snapshot.point, snapshot.flowerAnchor, snapshot.flowerPreview]);
  useLayoutEffect(() => {
    if (snapshot.dock?.collapsed) {
      jump(1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    } else if (wasCollapsed.current) animate(0);
    wasCollapsed.current = snapshot.dock?.collapsed ?? false;
    if (!canCollapse && !snapshot.dock?.collapsed) cancel();
  }, [snapshot.dock?.collapsed, canCollapse, cancel, animate, jump]);
  useEffect(
    () => () => {
      revision.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const reveal = async () => {
    cancel();
    try {
      await window.desktopPetals.revealDock(true);
    } catch (reason) {
      onError(reason);
    }
  };
  const scheduleCollapse = () => {
    cancel();
    if (!canCollapse) return;
    const current = revision.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      animate(1, () => {
        if (current !== revision.current || latest.current.flowerPreview) return;
        void window.desktopPetals
          .revealDock(false)
          .then(() => window.desktopPetals.snapshot())
          .then(async (next) => {
            if (current !== revision.current && next.dock?.collapsed) await window.desktopPetals.revealDock(true);
            else if (!next.dock?.collapsed) animate(0);
          })
          .catch((reason) => {
            if (current === revision.current) {
              animate(0);
              onError(reason);
            }
          });
      });
    }, FLOWER_MOTION.leave);
  };
  return {
    anchor,
    petalBounds,
    fold,
    cancel,
    reveal,
    scheduleCollapse,
    setPluckPreview,
    beginGesture: () => {
      cancel();
      if (!latest.current.dock?.collapsed) jump(0);
    },
    scheduleReveal: () => {
      cancel();
      timer.current = setTimeout(() => void reveal(), FLOWER_MOTION.hover);
    },
  };
}
