import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, Circle } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
export interface OutlineTreeRow {
  id: string;
  title: string;
  depth: number;
  parentId: string | null;
  expandable: boolean;
  expanded: boolean;
}
interface Props {
  rows: readonly OutlineTreeRow[];
  label: string;
  labels: { expand: string; collapse: string; zoom: string; empty: string; unnamed: string };
  onToggle(id: string): void;
  onOpen(id: string): void;
  onZoom(id: string): void;
}

function retainedFocus(rows: readonly OutlineTreeRow[], previous: readonly OutlineTreeRow[], focused: string | null) {
  const visible = new Set(rows.map((row) => row.id));
  const parents = new Map(previous.map((row) => [row.id, row.parentId]));
  const visited = new Set<string>();
  for (let id = focused; id && !visited.has(id); id = parents.get(id) ?? null) {
    if (visible.has(id)) return id;
    visited.add(id);
  }
  const index = previous.findIndex((row) => row.id === focused);
  return rows[Math.min(Math.max(index, 0), rows.length - 1)]?.id;
}

/** Shared navigation surface. Hosts own content, commands, selection scope and persistence. */
function ignoresOutlineKey(event: KeyboardEvent<HTMLDivElement>) {
  return (
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    event.key === 'Process' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  );
}

export function OutlineTree({ rows, label, labels, onToggle, onOpen, onZoom }: Props) {
  const [focused, setFocused] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const root = useRef<HTMLDivElement>(null);
  const previousRows = useRef(rows);
  const detachedFocus = useRef<HTMLDivElement | null>(null);
  const active = retainedFocus(rows, previousRows.current, focused);
  const siblingSizes = new Map<string | null, number>();
  const siblingPositions = new Map<string, number>();
  for (const row of rows) {
    const position = (siblingSizes.get(row.parentId) ?? 0) + 1;
    siblingSizes.set(row.parentId, position);
    siblingPositions.set(row.id, position);
  }
  useLayoutEffect(() => {
    previousRows.current = rows;
    // Persist the fallback even when search owns DOM focus. Otherwise another
    // refresh loses the removed row's ancestry and resets the tree's tab stop.
    if (focused !== (active ?? null)) setFocused(active ?? null);
    const removed = detachedFocus.current;
    detachedFocus.current = null;
    const tree = root.current;
    if (active && tree?.ownerDocument.activeElement === tree) {
      elements.current.get(active)?.focus();
      return;
    }
    if (!removed || removed.isConnected) return;
    const document = removed.ownerDocument;
    // Removing the focused row must not strand keyboard navigation on the body.
    // Never steal focus from the author's editor, search field or an open dialog.
    if (document.activeElement && document.activeElement !== document.body) return;
    (active ? elements.current.get(active) : tree)?.focus();
  }, [rows, active, focused]);
  const focus = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    elements.current.get(id)?.focus();
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>, row: OutlineTreeRow) => {
    if (ignoresOutlineKey(event)) return;
    // A disclosure or zoom button owns its native Enter/Space activation.
    if (event.target !== event.currentTarget && (event.key === 'Enter' || event.key === ' ')) return;
    const index = rows.findIndex((item) => item.id === row.id);
    switch (event.key) {
      case 'ArrowDown':
        focus(rows[index + 1]?.id);
        break;
      case 'ArrowUp':
        focus(rows[index - 1]?.id);
        break;
      case 'Home':
        focus(rows[0]?.id);
        break;
      case 'End':
        focus(rows[rows.length - 1]?.id);
        break;
      case 'ArrowRight':
        if (row.expandable && !row.expanded) onToggle(row.id);
        else if (rows[index + 1]?.parentId === row.id) focus(rows[index + 1].id);
        break;
      case 'ArrowLeft':
        if (row.expandable && row.expanded) onToggle(row.id);
        else focus(row.parentId ?? undefined);
        break;
      case 'Enter':
        if (event.shiftKey) onZoom(row.id);
        else onOpen(row.id);
        break;
      case ' ':
        if (row.expandable) onToggle(row.id);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div ref={root} role="tree" aria-label={label} tabIndex={rows.length ? -1 : 0} className="min-w-0 py-1">
      {rows.map((row) => (
        <div
          key={row.id}
          ref={(element) => {
            const previous = elements.current.get(row.id);
            if (!element && previous?.contains(previous.ownerDocument.activeElement)) detachedFocus.current = previous;
            if (element) elements.current.set(row.id, element);
            else elements.current.delete(row.id);
          }}
          role="treeitem"
          aria-label={row.title || labels.unnamed}
          aria-level={row.depth}
          aria-posinset={siblingPositions.get(row.id)}
          aria-setsize={siblingSizes.get(row.parentId)}
          aria-expanded={row.expandable ? row.expanded : undefined}
          aria-selected={active === row.id}
          tabIndex={active === row.id ? 0 : -1}
          data-outline-id={row.id}
          className="flex min-h-8 min-w-0 items-center rounded-sm text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          style={{ paddingInlineStart: (row.depth - 1) * 14 }}
          onFocus={() => setFocused(row.id)}
          onClick={() => {
            setFocused(row.id);
            onOpen(row.id);
          }}
          onKeyDown={(event) => keyDown(event, row)}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            tabIndex={-1}
            className="grid size-7 shrink-0 place-items-center"
            disabled={!row.expandable}
            aria-label={`${row.expanded ? labels.collapse : labels.expand} · ${row.title || labels.unnamed}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(row.id);
              focus(row.id);
            }}
          >
            {row.expandable &&
              (row.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />)}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            tabIndex={-1}
            className="grid size-6 shrink-0 place-items-center"
            aria-label={`${labels.zoom} · ${row.title || labels.unnamed}`}
            onClick={(event) => {
              event.stopPropagation();
              onZoom(row.id);
            }}
          >
            <Circle className="size-1.5 fill-current" />
          </Button>
          <span className="min-w-0 flex-1 truncate py-1 pr-2" title={row.title}>
            {row.title || labels.unnamed}
          </span>
        </div>
      ))}
      {!rows.length && <p className="p-3 text-sm text-muted-foreground">{labels.empty}</p>}
    </div>
  );
}
