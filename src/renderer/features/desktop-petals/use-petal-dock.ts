import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { useRoseFold } from '@/renderer/features/desktop-petals/use-rose-fold';
import { FLOWER_MOTION } from '@/shared/flower-geometry';
import { screenMagnifierRunning } from '@/shared/contracts/screen-magnifier';

export function usePetalDock(snapshot: DesktopPetalSnapshot, onError: (reason: unknown) => void) {
  const pointX = snapshot.point.x;
  const pointY = snapshot.point.y;
  const { fold, animate, jump } = useRoseFold(snapshot.dock?.collapsed ? 1 : 0);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const setPluckPreview = useCallback((active: boolean) => window.desktopPetals.pluckPreview(active), []);
  const [petalBounds, setPetalBounds] = useState(snapshot.dock?.petalBounds);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasCollapsed = useRef(snapshot.dock?.collapsed ?? false);
  const revision = useRef(0);
  // Keep docking paused until the active menu or pluck finishes its handoff.
  const canCollapse =
    snapshot.hubView === 'flower' &&
    snapshot.dock?.collapsed === false &&
    !snapshot.flowerPreview &&
    !screenMagnifierRunning(snapshot.magnifier);
  const cancel = useCallback(() => {
    revision.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!latest.current.dock?.collapsed) animate(0);
  }, [animate]);
  useLayoutEffect(() => {
    const update = () => {
      const bounds = snapshot.dock?.petalBounds;
      setPetalBounds(
        bounds
          ? {
              ...bounds,
              x: pointX + bounds.x - window.screenX,
              y: pointY + bounds.y - window.screenY,
            }
          : undefined,
      );
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [pointX, pointY, snapshot.dock?.petalBounds]);
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
        if (
          current !== revision.current ||
          latest.current.flowerPreview ||
          screenMagnifierRunning(latest.current.magnifier)
        )
          return;
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
