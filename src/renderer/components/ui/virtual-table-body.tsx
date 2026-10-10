import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { TableBody, TableCell, TableRow } from '@/renderer/components/ui/table';

type RowProps = ComponentProps<typeof TableRow>;

function MeasuredRow({
  id,
  measure,
  children,
  ...props
}: RowProps & { id: string; measure(id: string, height: number): void }) {
  const ref = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => measure(id, node.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, measure]);
  return (
    <TableRow {...props} ref={ref}>
      {children}
    </TableRow>
  );
}

/** Native table rows with measured heights, spacer rows and retained keyboard focus. */
export function VirtualTableBody<T>({
  items,
  itemKey,
  renderCells,
  rowProps,
  viewportRef,
  columns,
  active = true,
  empty,
}: {
  items: readonly T[];
  itemKey(item: T): string;
  renderCells(item: T): ReactNode;
  rowProps?(item: T): RowProps;
  viewportRef: RefObject<HTMLElement | null>;
  columns: number;
  active?: boolean;
  empty?: ReactNode;
}) {
  const rootRef = useRef<HTMLTableSectionElement>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [range, setRange] = useState({ start: 0, end: 1200 });
  const [focused, setFocused] = useState<string | null>(null);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const previousRows = useRef<unknown>(null);
  const measure = useCallback((id: string, height: number) => {
    if (height <= 0) return;
    const rounded = Math.ceil(height);
    setHeights((current) => (current.get(id) === rounded ? current : new Map(current).set(id, rounded)));
  }, []);
  const layout = useMemo(() => {
    let height = 0;
    const rows = items.map((item, index) => {
      const id = itemKey(item);
      const size = heights.get(id) ?? 72;
      const row = { item, id, index, start: height, end: height + size };
      height += size;
      return row;
    });
    return { rows, height };
  }, [items, itemKey, heights]);

  useLayoutEffect(() => {
    const ids = new Set(items.map(itemKey));
    setHeights((current) =>
      [...current.keys()].every((id) => ids.has(id)) ? current : new Map([...current].filter(([id]) => ids.has(id))),
    );
  }, [items, itemKey]);

  useLayoutEffect(() => {
    const root = rootRef.current,
      viewport = viewportRef.current;
    if (!root || !viewport || !active) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      if (!root.getClientRects().length || !viewport.clientHeight) return;
      if (previousRows.current !== layout.rows && anchor.current) {
        const row = layout.rows.find((row) => row.id === anchor.current!.id);
        if (row)
          viewport.scrollTop +=
            root.getBoundingClientRect().top - viewport.getBoundingClientRect().top + row.start - anchor.current.offset;
      }
      previousRows.current = layout.rows;
      const start = viewport.getBoundingClientRect().top - root.getBoundingClientRect().top;
      const row = start >= 0 ? layout.rows.find((row) => row.end > start) : undefined;
      anchor.current = row ? { id: row.id, offset: row.start - start } : null;
      const next = {
        start: Math.max(0, Math.floor((start - 320) / 160) * 160),
        end: Math.ceil((start + viewport.clientHeight + 320) / 160) * 160,
      };
      setRange((current) => (current.start === next.start && current.end === next.end ? current : next));
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    // Batch disclosure above the table can change its offset without scrolling.
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    viewport.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active, layout, viewportRef]);

  const focusedIndex = layout.rows.findIndex((row) => row.id === focused);
  const visible = active
    ? layout.rows.filter(
        (row) =>
          (row.end >= range.start && row.start <= range.end) ||
          (focusedIndex >= 0 && Math.abs(row.index - focusedIndex) <= 1),
      )
    : [];
  const children: ReactNode[] = [];
  let offset = 0;
  const spacer = (height: number, key: string) => {
    if (height > 0)
      children.push(
        <tr key={key} aria-hidden="true" className="border-0">
          <td colSpan={columns} className="border-0 p-0" style={{ height }} />
        </tr>,
      );
  };
  for (const row of visible) {
    spacer(row.start - offset, 'before:' + row.id);
    children.push(
      <MeasuredRow
        {...rowProps?.(row.item)}
        key={row.id}
        id={row.id}
        measure={measure}
        onFocusCapture={() => setFocused(row.id)}
      >
        {renderCells(row.item)}
      </MeasuredRow>,
    );
    offset = row.end;
  }
  spacer(layout.height - offset, 'after');
  return (
    <TableBody
      ref={rootRef}
      style={{ overflowAnchor: 'none' }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
      }}
    >
      {children}
      {items.length === 0 && empty && (
        <TableRow>
          <TableCell colSpan={columns} className="h-24 text-center text-muted-foreground">
            {empty}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}
