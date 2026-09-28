import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CollectionItemMeasurement, CollectionLayoutItem } from '@/renderer/components/gallery/collectionLayout';

type ObserveItem = (node: HTMLDivElement, id: string) => () => void;

/** One observer for mounted text items; a frame batches their updates into one layout pass. */
export function useCollectionItemMeasurements(items: readonly CollectionLayoutItem[]) {
  const [measurements, setMeasurements] = useState<ReadonlyMap<string, CollectionItemMeasurement>>(new Map());
  const nodes = useRef(new Map<HTMLDivElement, string>());
  const observer = useRef<ResizeObserver | null>(null);
  const pending = useRef(new Map<string, CollectionItemMeasurement>());
  const frame = useRef<number | null>(null);

  const record = useCallback((id: string, width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    pending.current.set(id, { width, height: Math.ceil(height) });
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const updates = new Map(pending.current);
      pending.current.clear();
      setMeasurements((current) => {
        const next = new Map(current);
        let changed = false;
        for (const [key, value] of updates) {
          const previous = current.get(key);
          if (previous && Math.abs(previous.width - value.width) < 0.5 && previous.height === value.height) continue;
          next.set(key, value);
          changed = true;
        }
        return changed ? next : current;
      });
    });
  }, []);

  const observe = useCallback<ObserveItem>(
    (node, id) => {
      nodes.current.set(node, id);
      const rect = node.getBoundingClientRect();
      record(id, rect.width, rect.height);
      observer.current?.observe(node);
      return () => {
        observer.current?.unobserve(node);
        nodes.current.delete(node);
      };
    },
    [record],
  );

  useLayoutEffect(() => {
    const pendingMeasurements = pending.current;
    const measureAll = () => {
      for (const [node, id] of nodes.current) {
        const rect = node.getBoundingClientRect();
        record(id, rect.width, rect.height);
      }
    };
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const id = nodes.current.get(entry.target as HTMLDivElement);
          if (id) record(id, entry.contentRect.width, entry.contentRect.height);
        }
      });
      for (const node of nodes.current.keys()) observer.current.observe(node);
    } else {
      window.addEventListener('resize', measureAll);
    }
    measureAll();
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      window.removeEventListener('resize', measureAll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
      pendingMeasurements.clear();
    };
  }, [record]);

  useLayoutEffect(() => {
    const ids = new Set(items.filter((item) => item.textOnly).map((item) => item.id));
    for (const id of pending.current.keys()) if (!ids.has(id)) pending.current.delete(id);
    setMeasurements((current) => {
      if ([...current.keys()].every((id) => ids.has(id))) return current;
      return new Map([...current].filter(([id]) => ids.has(id)));
    });
  }, [items]);

  return { measurements, observe };
}

export function CollectionMeasuredItem({
  id,
  observe,
  children,
}: {
  id: string;
  observe: ObserveItem;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) return observe(ref.current, id);
  }, [id, observe]);
  return (
    <div ref={ref} className="flow-root w-full">
      {children}
    </div>
  );
}
