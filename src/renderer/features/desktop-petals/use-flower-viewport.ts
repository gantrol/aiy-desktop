import { useLayoutEffect, useState } from 'react';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';

/** Use the host's local anchor so timer redraws cannot undo a window drag. */
export function useFlowerViewport(snapshot: DesktopPetalSnapshot) {
  const [, resized] = useState(0);
  useLayoutEffect(() => {
    const update = () => resized((value) => value + 1);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    x: snapshot.flowerAnchor.x,
    y: snapshot.flowerAnchor.y,
  };
}
