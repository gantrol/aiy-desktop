import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { tabItems } from '@/renderer/components/workspace/workspace-tab-drag-geometry';
import {
  animateTabMorph,
  tabMorphSnapshot,
  type TabMorphSnapshot,
} from '@/renderer/components/workspace/workspace-tab-morph';

interface TabPosition {
  id: string;
  rect: DOMRect;
  list: boolean;
}

/** Capture before a committed operation; animate only the affected tab headers. */
export function useWorkspaceTabMotion(
  orderKey: string,
  strip: RefObject<HTMLDivElement | null>,
  list: RefObject<HTMLDivElement | null>,
) {
  const positions = useRef<TabPosition[]>([]);
  const animations = useRef(new Set<Animation>());
  const morph = useRef<TabMorphSnapshot | null>(null);
  const morphCleanup = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
    morphCleanup.current?.();
  }, []);
  const capture = useCallback(
    (excludeId?: string, morphId?: string) => {
      positions.current = [strip.current, list.current].flatMap((root, index) =>
        root
          ? tabItems(root)
              .filter((node) => node.dataset.workspaceTabItem !== excludeId)
              .map((node) => ({
                id: node.dataset.workspaceTabItem!,
                rect: node.getBoundingClientRect(),
                list: index === 1,
              }))
          : [],
      );
      cancel();
      const subject = [list.current, strip.current]
        .flatMap((node) => (node ? tabItems(node) : []))
        .find((node) => node.dataset.workspaceTabItem === morphId);
      morph.current = subject ? tabMorphSnapshot(subject) : null;
    },
    [strip, list, cancel],
  );

  useLayoutEffect(() => {
    const previous = positions.current;
    const shape = morph.current;
    positions.current = [];
    morph.current = null;
    if (!previous.length || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    [strip.current, list.current].forEach((root, index) => {
      if (!root) return;
      for (const node of tabItems(root)) {
        if (!node.animate) continue;
        const to = node.getBoundingClientRect();
        if (
          shape &&
          shape.id === node.dataset.workspaceTabItem &&
          index === 0 &&
          Math.abs(shape.rect.left - to.left) < 400 &&
          Math.abs(shape.rect.top - to.top) < 240
        ) {
          morphCleanup.current = animateTabMorph(shape, node, () => {
            morphCleanup.current = null;
          });
          continue;
        }
        const from = previous.find(
          (entry) => entry.id === node.dataset.workspaceTabItem && entry.list === (index === 1),
        );
        if (!from) continue;
        const x = from.rect.left - to.left;
        const y = from.rect.top - to.top;
        if (!x && !y && from.rect.width === to.width) continue;
        const near = Math.abs(x) < 400 && Math.abs(y) < 240;
        const animation = node.animate(
          [
            {
              transform: near ? `translate(${x}px, ${y}px)` : 'none',
              opacity: near ? 1 : 0.4,
              clipPath:
                to.width > from.rect.width ? `inset(0 ${Math.max(0, to.width - from.rect.width)}px 0 0)` : 'inset(0)',
            },
            { transform: 'none', opacity: 1, clipPath: 'inset(0)' },
          ],
          { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
        animations.current.add(animation);
        animation.onfinish = () => animations.current.delete(animation);
      }
    });
    if (shape && strip.current && !tabItems(strip.current).some((node) => node.dataset.workspaceTabItem === shape.id)) {
      const overflow = strip.current?.querySelector<HTMLElement>('[data-workspace-pinned-overflow]');
      if (overflow?.animate) {
        const animation = overflow.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 120 });
        animations.current.add(animation);
        animation.onfinish = () => animations.current.delete(animation);
      }
    }
  }, [orderKey, strip, list]);
  useEffect(() => cancel, [cancel]);
  return { capture, cancel };
}
