import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MasonrySurface } from '@/renderer/components/ui/masonry-surface';

function MeasuredRow({
  id,
  measure,
  children,
}: {
  id: string;
  measure(id: string, width: number, height: number): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      measure(id, rect.width, rect.height);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [id, measure]);
  return (
    <div ref={ref} className="flow-root w-full">
      {children}
    </div>
  );
}

/** Variable-height rows share the masonry surface's scroll anchor and focus retention. */
export function VirtualList<T>({
  items,
  itemKey,
  renderItem,
  viewportRef,
  estimatedHeight = 64,
  active = true,
  className,
}: {
  items: readonly T[];
  itemKey(item: T): string;
  renderItem(item: T, index: number): ReactNode;
  viewportRef: RefObject<HTMLElement | null>;
  estimatedHeight?: number;
  active?: boolean;
  className?: string;
}) {
  const [sizes, setSizes] = useState<ReadonlyMap<string, { width: number; height: number }>>(new Map());
  const entries = useMemo(() => items.map((item) => ({ id: itemKey(item), aspectRatio: 1 })), [items, itemKey]);
  const measure = useCallback((id: string, width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    const nextHeight = Math.ceil(height);
    setSizes((previous) => {
      const size = previous.get(id);
      if (size && Math.abs(size.width - width) < 0.5 && size.height === nextHeight) return previous;
      return new Map(previous).set(id, { width, height: nextHeight });
    });
  }, []);
  useLayoutEffect(() => {
    const ids = new Set(entries.map((item) => item.id));
    setSizes((previous) =>
      [...previous.keys()].every((id) => ids.has(id)) ? previous : new Map([...previous].filter(([id]) => ids.has(id))),
    );
  }, [entries]);
  const computeLayout = useCallback(
    (width: number) => {
      let height = 0;
      const placements = entries.map((entry, index) => {
        const size = sizes.get(entry.id);
        const rowHeight = size && Math.abs(size.width - width) < 1 ? size.height : estimatedHeight;
        const placement = { id: entry.id, index, column: 0, x: 0, y: height, width, height: rowHeight };
        height += rowHeight;
        return placement;
      });
      return { placements, height, columnCount: 1, columnWidth: width };
    },
    [entries, sizes, estimatedHeight],
  );
  return (
    <MasonrySurface
      items={entries}
      computeLayout={computeLayout}
      viewportRef={viewportRef}
      virtualize
      preserveScrollAnchor
      virtualOverscan={320}
      className={className}
      renderItem={(entry, index) =>
        active ? (
          <MeasuredRow id={entry.id} measure={measure}>
            {renderItem(items[index], index)}
          </MeasuredRow>
        ) : null
      }
    />
  );
}
