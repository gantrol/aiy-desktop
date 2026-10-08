import { useLayoutEffect, useState } from 'react';

/** Commit one resolved layout after the destination's measurement and registration effects settle. */
export function useWorkspaceSidebarLayout(width: number | null, animate: boolean, navigationKey: string) {
  const [layout, setLayout] = useState({ width: 0, animate: false, navigationKey });
  useLayoutEffect(() => {
    // A loading screen has not declared its layout yet. Keep the frame, not the previous tab's controls.
    if (width === null) return;
    if (layout.width === width && layout.animate === animate && layout.navigationKey === navigationKey) return;
    let cancelled = false;
    // Layout effects may register an intermediate zero before the new sidebar measures its container.
    // Coalesce those commits before painting; navigation and the destination's content stay immediate.
    queueMicrotask(() => {
      if (!cancelled) setLayout({ width, animate, navigationKey });
    });
    return () => {
      cancelled = true;
    };
  }, [width, animate, navigationKey, layout]);
  return layout;
}
