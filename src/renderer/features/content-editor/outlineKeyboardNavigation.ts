import type { Editor } from '@tiptap/core';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  outlineViewState,
  outlineVisibleItems,
  setOutlineView,
} from '@/renderer/features/content-editor/outlineViewState';

interface TitleRange {
  id: string;
  from: number;
  to: number;
}

const preferredColumn = new WeakMap<EditorView, number>();

function currentTitle(state: EditorState): TitleRange | null {
  const { $from } = state.selection;
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    if ($from.node(depth).attrs.outlineRole === 'NOTE' || $from.node(depth).type.name === 'taskList') return null;
  }
  for (let depth = $from.depth; depth >= 2; depth -= 1) {
    const item = $from.node(depth);
    if (item.type.name !== 'listItem' || item.firstChild?.type.name !== 'paragraph' || !item.attrs.blockId) continue;
    const from = $from.before(depth) + 2;
    const to = from + item.firstChild.content.size;
    return state.selection.from >= from && state.selection.from <= to ? { id: item.attrs.blockId, from, to } : null;
  }
  return null;
}

function titleById(state: EditorState, id: string): TitleRange | null {
  let title: TitleRange | null = null;
  state.doc.descendants((node, position) => {
    if (title || node.type.name !== 'listItem' || node.attrs.blockId !== id) return;
    if (node.firstChild?.type.name !== 'paragraph') return;
    const from = position + 2;
    title = { id, from, to: from + node.firstChild.content.size };
  });
  return title;
}

function positionAtColumn(view: EditorView, position: number, title: TitleRange) {
  try {
    const column = preferredColumn.get(view) ?? view.coordsAtPos(view.state.selection.from).left;
    preferredColumn.set(view, column);
    const edge = view.coordsAtPos(position);
    const hit = view.posAtCoords({ left: column, top: (edge.top + edge.bottom) / 2 });
    return hit ? Math.max(title.from, Math.min(title.to, hit.pos)) : position;
  } catch {
    return position;
  }
}

export function handleOutlineArrow(editor: Editor, view: EditorView, event: KeyboardEvent) {
  const direction = event.key;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(direction)) {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) preferredColumn.delete(view);
    return false;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || !view.state.selection.empty) return false;
  const current = currentTitle(view.state);
  if (!current) return false;
  const vertical = direction === 'ArrowUp' || direction === 'ArrowDown';
  if (
    vertical
      ? !view.endOfTextblock(direction === 'ArrowUp' ? 'up' : 'down')
      : view.state.selection.from !== (direction === 'ArrowLeft' ? current.from : current.to)
  ) {
    if (!vertical) preferredColumn.delete(view);
    return false;
  }
  const rows = outlineVisibleItems(view.state.doc, outlineViewState(view.state));
  const index = rows.findIndex((row) => row.id === current.id);
  const previous = direction === 'ArrowLeft' || direction === 'ArrowUp';
  const neighbor = index < 0 ? null : rows[index + (previous ? -1 : 1)];
  const title = neighbor && titleById(view.state, neighbor.id);
  if (!title) return false;
  if (event.shiftKey) {
    if (!vertical) return false;
    event.preventDefault();
    setOutlineView(editor, {
      ...outlineViewState(view.state),
      selected: [current.id, title.id],
      anchor: current.id,
      active: title.id,
    });
    return true;
  }
  const edge = previous ? title.to : title.from;
  const position = vertical ? positionAtColumn(view, edge, title) : edge;
  if (!vertical) preferredColumn.delete(view);
  event.preventDefault();
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, position))
      .setMeta('aiy:block-navigation', true)
      .scrollIntoView(),
  );
  return true;
}
