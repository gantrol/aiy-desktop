import { useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceRuntimeTab } from '@/renderer/components/workspace/workspace-state';

/** Measure only the tab viewport, so the tools and pane controls keep their space. */
export function useWorkspaceTabLayout(tabs: readonly WorkspaceRuntimeTab[], vertical: boolean, compact: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const [extent, setExtent] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      setExtent(vertical ? bounds.height : bounds.width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [vertical]);

  const pinned = tabs.filter((tab) => tab.pinned);
  const regular = tabs.filter((tab) => !tab.pinned);
  // Account for the 2px item gaps, separator and viewport padding.
  const slotSize = compact ? 30 : 34;
  const stripInset = compact ? 16 : 24;
  const regularReserve = regular.length ? (vertical ? 56 : 120) : 0;
  const slots =
    extent === null ? 3 : Math.max(1, Math.min(3, Math.floor((extent - regularReserve - stripInset) / slotSize)));
  const overflow = pinned.length > slots;
  const visiblePinned = overflow ? pinned.slice(0, slots - 1) : pinned;

  return { viewport, pinned, regular, visiblePinned, overflow };
}
