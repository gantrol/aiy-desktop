import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ImageEditDocument } from '@/shared/contracts/image-edit';

export function ImageEditOverlay({
  group,
  container,
  box,
  children,
}: {
  group: RefObject<SVGGElement | null>;
  container: RefObject<HTMLDivElement | null>;
  box: ImageEditDocument['crop'] | null;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    const element = container.current;
    const overlay = panel.current;
    if (!element || !overlay) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      const matrix = group.current?.getScreenCTM();
      let left = 8,
        top = bounds.height - overlay.offsetHeight - 8;
      if (box && matrix) {
        const points = [
          new DOMPoint(box.x, box.y),
          new DOMPoint(box.x + box.width, box.y),
          new DOMPoint(box.x, box.y + box.height),
          new DOMPoint(box.x + box.width, box.y + box.height),
        ].map((point) => point.matrixTransform(matrix));
        left = Math.min(...points.map((point) => point.x)) - bounds.left;
        top = Math.min(...points.map((point) => point.y)) - bounds.top - overlay.offsetHeight - 8;
        if (top < 8) top = Math.max(...points.map((point) => point.y)) - bounds.top + 8;
      }
      setPosition({
        left: Math.max(8, Math.min(left, bounds.width - overlay.offsetWidth - 8)),
        top: Math.max(8, Math.min(top, bounds.height - overlay.offsetHeight - 8)),
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(overlay);
    element.addEventListener('scroll', update);
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [group, container, box]);
  return (
    <div
      ref={panel}
      style={position}
      className="absolute z-30 max-w-[calc(100%-1rem)] rounded-sm border border-border bg-surface shadow-overlay"
    >
      {children}
    </div>
  );
}
