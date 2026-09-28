import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isOutlineChildList, isOutlineNoteList } from '@/shared/outline-structure';
import {
  outlineViewState,
  outlineVisibleItems,
  setOutlineView,
  type OutlineViewState,
} from '@/renderer/features/content-editor/outlineViewState';

interface NavigationStop {
  from: number;
  to: number;
  itemId: string | null;
  title: boolean;
  atom: boolean;
}

const preferredColumn = new WeakMap<EditorView, number>();

/** Walk visible content in document order, including notes and selectable media. */
function navigationStops(doc: ProseMirrorNode, state: OutlineViewState): NavigationStop[] {
  const stops: NavigationStop[] = [];
  const visible = new Set(outlineVisibleItems(doc, state).map((item) => item.id));
  const visitContent = (
    node: ProseMirrorNode,
    position: number,
    itemId: string | null,
    title = false,
    structural = true,
  ) => {
    if (structural && isOutlineChildList({ type: node.type.name, attrs: node.attrs })) {
      node.forEach((child, offset) => visitItem(child, position + 1 + offset));
    } else if (node.isTextblock) {
      stops.push({ from: position + 1, to: position + 1 + node.content.size, itemId, title, atom: false });
    } else if (node.isAtom && node.isBlock && node.type.spec.selectable !== false) {
      stops.push({ from: position, to: position + node.nodeSize, itemId, title: false, atom: true });
    } else {
      const nestedStructure = structural && !isOutlineNoteList({ type: node.type.name, attrs: node.attrs });
      node.forEach((child, offset) => visitContent(child, position + 1 + offset, itemId, false, nestedStructure));
    }
  };
  const visitItem = (item: ProseMirrorNode, position: number) => {
    const id = String(item.attrs.blockId ?? '');
    const shown = visible.has(id);
    item.forEach((child, offset, index) => {
      if (shown) {
        if (index === 0 || !state.folded.has(id)) visitContent(child, position + 1 + offset, id, index === 0);
      } else if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) {
        // The focused branch may live inside an ancestor whose own content is hidden.
        child.forEach((nested, nestedOffset) => visitItem(nested, position + 2 + offset + nestedOffset));
      }
    });
  };
  doc.forEach((node, position) => {
    if (isOutlineChildList({ type: node.type.name, attrs: node.attrs }) || !state.focus)
      visitContent(node, position, null);
  });
  return stops;
}

function positionAtColumn(view: EditorView, position: number, stop: NavigationStop) {
  try {
    const column = preferredColumn.get(view) ?? view.coordsAtPos(view.state.selection.from).left;
    preferredColumn.set(view, column);
    const edge = view.coordsAtPos(position);
    const hit = view.posAtCoords({ left: column, top: (edge.top + edge.bottom) / 2 });
    return hit ? Math.max(stop.from, Math.min(stop.to, hit.pos)) : position;
  } catch {
    return position;
  }
}

function extendTitleSelection(editor: Editor, current: NavigationStop, next: NavigationStop) {
  if (!current.title || !next.title || !current.itemId || !next.itemId) return false;
  setOutlineView(editor, {
    ...outlineViewState(editor.state),
    selected: [current.itemId, next.itemId],
    anchor: current.itemId,
    active: next.itemId,
  });
  return true;
}

export function handleOutlineArrow(editor: Editor, view: EditorView, event: KeyboardEvent) {
  const direction = event.key;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(direction)) {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) preferredColumn.delete(view);
    return false;
  }
  const selection = view.state.selection;
  const nodeSelected = selection instanceof NodeSelection;
  if (event.altKey || event.ctrlKey || event.metaKey || (!selection.empty && !nodeSelected)) return false;
  const vertical = direction === 'ArrowUp' || direction === 'ArrowDown';
  const previous = direction === 'ArrowLeft' || direction === 'ArrowUp';
  if (
    !nodeSelected &&
    (vertical
      ? !view.endOfTextblock(previous ? 'up' : 'down')
      : selection.$from.parentOffset !== (previous ? 0 : selection.$from.parent.content.size))
  ) {
    if (!vertical) preferredColumn.delete(view);
    return false;
  }
  const state = outlineViewState(view.state);
  const stops = navigationStops(view.state.doc, state);
  const index = stops.findIndex((stop) =>
    nodeSelected
      ? stop.atom && stop.from === selection.from
      : !stop.atom && selection.from >= stop.from && selection.from <= stop.to,
  );
  const current = stops[index];
  const next = index < 0 ? null : stops[index + (previous ? -1 : 1)];
  if (!current || !next) return false;
  if (event.shiftKey) {
    if (!vertical || !extendTitleSelection(editor, current, next)) return false;
    event.preventDefault();
    return true;
  }
  const edge = previous ? next.to : next.from;
  const target = next.atom
    ? NodeSelection.create(view.state.doc, next.from)
    : TextSelection.create(view.state.doc, vertical ? positionAtColumn(view, edge, next) : edge);
  if (!vertical) preferredColumn.delete(view);
  event.preventDefault();
  view.dispatch(view.state.tr.setSelection(target).setMeta('aiy:block-navigation', true).scrollIntoView());
  return true;
}
