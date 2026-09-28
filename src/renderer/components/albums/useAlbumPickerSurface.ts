import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

interface Surface {
  compact: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  boundary: HTMLElement | null;
}

export function useAlbumPickerSurface(open: boolean, trigger: RefObject<HTMLButtonElement | null>) {
  const [surface, setSurface] = useState<Surface>({
    compact: false,
    left: 8,
    top: 8,
    width: 320,
    height: 384,
    boundary: null,
  });
  useLayoutEffect(() => {
    const element = trigger.current;
    if (!open || !element) return;
    const boundary = element.closest<HTMLElement>('[data-slot="dialog-content"], [data-workbench-pane]');
    const measure = () => {
      const host = boundary?.getBoundingClientRect();
      const left = Math.max(0, host?.left ?? 0) + 8;
      const top = Math.max(0, host?.top ?? 0) + 8;
      const width = Math.max(0, Math.min(window.innerWidth, host?.right ?? window.innerWidth) - left - 8);
      const height = Math.max(0, Math.min(window.innerHeight, host?.bottom ?? window.innerHeight) - top - 8);
      const anchor = element.getBoundingClientRect();
      const availableHeight = Math.max(anchor.top - top, top + height - anchor.bottom) - 5;
      const compact = width < 360 || availableHeight < 256;
      const next: Surface = {
        compact,
        left,
        top,
        boundary,
        width: compact ? width : Math.min(width, Math.max(288, Math.min(360, anchor.width))),
        height: compact ? height : Math.min(384, availableHeight),
      };
      setSurface((current) =>
        Object.keys(next).every((key) => current[key as keyof Surface] === next[key as keyof Surface]) ? current : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(boundary ?? document.documentElement);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, trigger]);
  // A virtual anchor fills the available host without remounting the panel or losing its draft/focus.
  const virtualRef = useMemo(
    () => ({
      current: { getBoundingClientRect: () => new DOMRect(surface.left, surface.top, surface.width, 0) },
    }),
    [surface.left, surface.top, surface.width],
  );
  return { ...surface, virtualRef };
}
