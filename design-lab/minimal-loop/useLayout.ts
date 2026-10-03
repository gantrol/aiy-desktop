import { useEffect, useRef, useState } from 'react';
import type { Panel } from './types';

const thresholds: Record<Panel, number> = { topics: 960, inputs: 1280, outputs: 1100 };

/** Temporary space constraints never overwrite the author's panel preferences. */
export function useLayout() {
  const container = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const [panels, setPanels] = useState<Record<Panel, boolean>>({ topics: true, inputs: true, outputs: true });
  const [drawer, setDrawer] = useState<Panel | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(entry.contentRect.width);
      const focusedPanel = document.activeElement?.closest<HTMLElement>('[data-minimal-panel]');
      const panel = focusedPanel?.dataset.minimalPanel as Panel | undefined;
      if (panel && nextWidth < thresholds[panel]) {
        element.querySelector<HTMLButtonElement>(`[data-minimal-trigger="${panel}"]`)?.focus();
      }
      setWidth(nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (drawer && width >= thresholds[drawer]) setDrawer(null);
  }, [drawer, width]);
  const fits = (panel: Panel) => width >= thresholds[panel];
  const visible = (panel: Panel) => fits(panel) && panels[panel];
  function toggle(panel: Panel) {
    if (!fits(panel)) setDrawer(panel);
    else setPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }
  return { container, panels, drawer, setDrawer, visible, toggle };
}
