import { useRef, useState, type KeyboardEvent } from 'react';
import type { OutlineRow } from '@/renderer/features/creation-outline/outline-tree';

export function useOutlineSelection(
  rows: readonly OutlineRow[],
  open: (key: string) => void,
  toggle: (key: string) => void,
  expanded: ReadonlySet<string>,
  collapsible: boolean,
) {
  const [selected, setSelected] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const visibleKeys = rows.map((row) => row.node.key);
  const visibleSet = new Set(visibleKeys);
  const selection = selected.filter((key) => visibleSet.has(key));
  const focusKey = focused && visibleSet.has(focused) ? focused : (visibleKeys[0] ?? null);

  function focus(key: string) {
    setFocused(key);
    requestAnimationFrame(() => elements.current.get(key)?.focus({ preventScroll: false }));
  }
  function choose(key: string, shift = false, additive = false) {
    if (shift && anchor.current && visibleSet.has(anchor.current)) {
      const from = visibleKeys.indexOf(anchor.current);
      const to = visibleKeys.indexOf(key);
      const range = visibleKeys.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelected(additive ? [...new Set([...selection, ...range])] : range);
    } else {
      setSelected(
        additive ? (selection.includes(key) ? selection.filter((id) => id !== key) : [...selection, key]) : [key],
      );
      anchor.current = key;
    }
    focus(key);
  }
  function clear() {
    setSelected([]);
    anchor.current = null;
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, row: OutlineRow) {
    if (event.target !== event.currentTarget) return;
    const index = visibleKeys.indexOf(row.node.key);
    const control = event.ctrlKey || event.metaKey;
    if (control && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(visibleKeys);
      anchor.current = visibleKeys[0] ?? null;
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clear();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      open(row.node.key);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      choose(row.node.key, event.shiftKey, true);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (collapsible && row.node.children.length && !expanded.has(row.node.key)) toggle(row.node.key);
      else if (rows[index + 1]?.depth > row.depth) focus(rows[index + 1].node.key);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (collapsible && row.node.children.length && expanded.has(row.node.key)) toggle(row.node.key);
      else if (row.node.parent && visibleSet.has(row.node.parent)) focus(row.node.parent);
      return;
    }
    const next =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, rows.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : null;
    if (next === null || !rows[next]) return;
    event.preventDefault();
    if (control && !event.shiftKey) focus(rows[next].node.key);
    else choose(rows[next].node.key, event.shiftKey, control);
  }
  return { selection, focusKey, elements, choose, clear, onKeyDown, focusRow: focus };
}
