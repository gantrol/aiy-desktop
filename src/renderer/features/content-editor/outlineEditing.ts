import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, TextSelection, type EditorState, type Selection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { isOutlineChildList } from '@/shared/outline-structure';
import { activeOutlineView, rememberOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import {
  copyOutlineSelection,
  pasteExternalOutlineText,
  pasteOutlineSelection,
} from '@/renderer/features/content-editor/outlineClipboard';
import { continueOutlineLists } from '@/renderer/features/content-editor/outlineListContinuation';
import { synchronizeContentEditorSelectionFromDom } from '@/renderer/features/content-editor/contentEditorKeyboard';
import { handleOutlineArrow } from '@/renderer/features/content-editor/outlineKeyboardNavigation';
import { commandMatchesShortcut } from '@/renderer/commands/app-shortcuts';
import {
  focusOutlineItem,
  attachOutlineView,
  endOutlineDrag,
  outlineFocusPath,
  outlinePlacementWithinFocus,
  outlineViewState,
  outlineVisibleItems,
  OutlineView,
  type OutlineViewState,
  selectOutlineItem,
  setOutlineView,
  setSelectedOutlineItemsFolded,
  toggleOutlineFold,
} from '@/renderer/features/content-editor/outlineViewState';
import {
  deleteOutlineStructure,
  moveOutlineStructure,
  outlineItemRecords,
  outlineMoveTargets,
  outlineSelectionRoots,
  type OutlineDropPlacement,
} from '@/renderer/features/content-editor/outlineMove';
import { planOutlineBatchMove, type OutlineBatchMoveAction } from '@/renderer/features/content-editor/outlineBatch';

interface ItemLocation {
  item: ProseMirrorNode;
  itemPos: number;
  list: ProseMirrorNode;
  listPos: number;
  listDepth: number;
  index: number;
}

function itemAt(state: EditorState, position: number): ItemLocation | null {
  const resolved = state.doc.resolve(position);
  for (let depth = resolved.depth; depth >= 2; depth -= 1) {
    if (resolved.node(depth).type.name !== 'listItem') continue;
    const listDepth = depth - 1;
    if (!['bulletList', 'orderedList', 'taskList'].includes(resolved.node(listDepth).type.name)) return null;
    for (let ancestor = 1; ancestor <= listDepth; ancestor += 1) {
      if (resolved.node(ancestor).attrs.outlineRole === 'NOTE' || resolved.node(ancestor).type.name === 'taskList')
        return null;
    }
    return {
      item: resolved.node(depth),
      itemPos: resolved.before(depth),
      list: resolved.node(listDepth),
      listPos: resolved.before(listDepth),
      listDepth,
      index: resolved.index(listDepth),
    };
  }
  return null;
}

function itemById(state: EditorState, blockId: string): ItemLocation | null {
  let position: number | null = null;
  state.doc.descendants((node, pos) => {
    if (position === null && node.type.name === 'listItem' && node.attrs.blockId === blockId) position = pos;
  });
  return position === null ? null : itemAt(state, position + 2);
}

function firstParagraphRange(location: ItemLocation) {
  if (location.item.firstChild?.type.name !== 'paragraph') return null;
  const from = location.itemPos + 2;
  return { from, to: from + location.item.firstChild.content.size };
}

function selectionInOutlineTitle(state: EditorState) {
  const location = itemAt(state, state.selection.from);
  const range = location && firstParagraphRange(location);
  return Boolean(range && state.selection.from >= range.from && state.selection.to <= range.to);
}

function locateItem(doc: ProseMirrorNode, blockId: string): number | null {
  let found: number | null = null;
  doc.descendants((node, position) => {
    if (found === null && node.type.name === 'listItem' && node.attrs.blockId === blockId) found = position;
  });
  return found;
}

function commitList(
  editor: Editor,
  location: ItemLocation,
  items: readonly ProseMirrorNode[],
  focusId: string,
  nextView = outlineViewState(editor.state),
) {
  const transaction = closeHistory(editor.state.tr).replaceWith(
    location.listPos,
    location.listPos + location.list.nodeSize,
    location.list.copy(Fragment.fromArray([...items])),
  );
  const position = locateItem(transaction.doc, focusId);
  if (position === null) return false;
  transaction.setSelection(TextSelection.create(transaction.doc, position + 2));
  attachOutlineView(transaction, nextView, outlineViewState(editor.state));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

function mainSelectionOffsets(location: ItemLocation, selection: Selection): [number, number] {
  const range = firstParagraphRange(location);
  if (!range || selection.from < range.from || selection.to > range.to) return [0, 0];
  return [selection.from - range.from, selection.to - range.from];
}

function freshItem(editor: Editor, content: Fragment = Fragment.empty) {
  const paragraph = editor.schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }, content);
  return editor.schema.nodes.listItem.create({ blockId: crypto.randomUUID() }, paragraph);
}

function siblings(location: ItemLocation) {
  return Array.from({ length: location.list.childCount }, (_, index) => location.list.child(index));
}

function childGroupIndex(item: ProseMirrorNode) {
  for (let index = 1; index < item.childCount; index += 1) {
    const child = item.child(index);
    if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) return index;
  }
  return -1;
}

export function splitOutlineItem(editor: Editor): boolean {
  if (!editor.isEditable || activeOutlineView(editor).composing) return false;
  const { state } = editor;
  const location = itemAt(state, state.selection.from);
  if (!location) return false;
  const range = firstParagraphRange(location);
  if (!range || state.selection.from < range.from || state.selection.to > range.to) return false;
  const paragraph = location.item.firstChild!;
  const start = state.selection.from - range.from;
  const end = state.selection.to - range.from;
  const view = outlineViewState(state);
  const focusedRoot = view.focus === location.item.attrs.blockId;
  const original = siblings(location);
  if (start === 0 && end < paragraph.content.size && !focusedRoot) {
    if (end > 0) {
      const content = Array.from({ length: location.item.childCount }, (_, index) => location.item.child(index));
      content[0] = paragraph.copy(paragraph.content.cut(end));
      original[location.index] = location.item.copy(Fragment.fromArray(content));
    }
    const added = freshItem(editor);
    original.splice(location.index, 0, added);
    return commitList(editor, location, original, added.attrs.blockId);
  }
  if (
    !focusedRoot &&
    location.listDepth > 1 &&
    paragraph.content.size === end - start &&
    location.item.childCount === 1 &&
    location.index === location.list.childCount - 1 &&
    outdentEmptyOutlineItem(editor, location.item.attrs.blockId)
  ) {
    return true;
  }
  const keepRootText = focusedRoot && start === 0 && end < paragraph.content.size;
  const before = paragraph.copy(keepRootText ? paragraph.content.cut(end) : paragraph.content.cut(0, start));
  const after = keepRootText ? Fragment.empty : paragraph.content.cut(end);
  const added = freshItem(editor, after);
  const content = Array.from({ length: location.item.childCount }, (_, index) => location.item.child(index));
  content[0] = before;
  let updated = location.item.copy(Fragment.fromArray(content));
  const childrenIndex = childGroupIndex(updated);
  if (childrenIndex >= 0 && (focusedRoot || !view.folded.has(location.item.attrs.blockId))) {
    const group = updated.child(childrenIndex);
    const nextGroup = group.copy(
      Fragment.fromArray([added, ...Array.from({ length: group.childCount }, (_, i) => group.child(i))]),
    );
    content[childrenIndex] = nextGroup;
    updated = location.item.copy(Fragment.fromArray(content));
    original[location.index] = updated;
  } else if (focusedRoot) {
    content.push(
      editor.schema.nodes.bulletList.create({ blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' }, added),
    );
    original[location.index] = location.item.copy(Fragment.fromArray(content));
  } else {
    original.splice(location.index, 1, updated, added);
  }
  const folded = new Set(view.folded);
  if (focusedRoot) folded.delete(location.item.attrs.blockId);
  return commitList(editor, location, original, added.attrs.blockId, { ...view, folded });
}

export function splitOutlineNote(editor: Editor): boolean {
  if (!editor.isEditable || activeOutlineView(editor).composing) return false;
  const location = itemAt(editor.state, editor.state.selection.from);
  const main = location && firstParagraphRange(location);
  if (!main || editor.state.selection.from <= main.to) return false;
  if (editor.state.selection.$from.parent.type.name !== 'paragraph') return false;
  return editor.commands.splitBlock();
}

function outlineMovePlan(editor: Editor, selectedIds: readonly string[], action: OutlineBatchMoveAction) {
  const view = outlineViewState(editor.state);
  return planOutlineBatchMove({
    document: editor.state.doc.toJSON(),
    selectedIds,
    visibleIds: outlineVisibleItems(editor.state.doc, view).map((row) => row.id),
    focus: view.focus,
    action,
  });
}

/** Enter first consumes the text selection, then applies the empty-item rule atomically. */
function outdentEmptyOutlineItem(editor: Editor, blockId: string): boolean {
  const records = outlineItemRecords(editor.state.doc.toJSON());
  const parent = records.get(blockId)?.ancestors.at(-1);
  const siblings = [...records].filter(([, row]) => row.ancestors.at(-1) === parent);
  if (siblings.at(-1)?.[0] !== blockId) return false;
  const plan = outlineMovePlan(editor, [blockId], 'outdent');
  if (!plan) return false;
  if (editor.state.selection.empty) return outdentOutlineItem(editor, blockId);
  const view = outlineViewState(editor.state);
  const transaction = closeHistory(editor.state.tr).deleteSelection();
  const moved = moveOutlineStructure(transaction.doc.toJSON(), plan.roots, plan.targetId, plan.placement);
  if (!moved) return false;
  const document = editor.schema.nodeFromJSON(moved);
  transaction.replaceWith(0, transaction.doc.content.size, document.content);
  const position = locateItem(transaction.doc, blockId);
  if (position === null) return false;
  transaction.setSelection(TextSelection.create(transaction.doc, position + 2));
  attachOutlineView(transaction, view, view);
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

function applyOutlineMoveAction(editor: Editor, selectedIds: readonly string[], action: OutlineBatchMoveAction) {
  if (!editor.isEditable || activeOutlineView(editor).composing) return false;
  const plan = outlineMovePlan(editor, selectedIds, action);
  return plan
    ? moveOutlineSelection(editor, plan.roots, plan.targetId, plan.placement, { expandTarget: plan.expandTarget })
    : false;
}

export function indentOutlineItem(editor: Editor, blockId: string): boolean {
  return applyOutlineMoveAction(editor, [blockId], 'indent');
}

export function outdentOutlineItem(editor: Editor, blockId: string): boolean {
  return applyOutlineMoveAction(editor, [blockId], 'outdent');
}

export function moveOutlineItem(editor: Editor, blockId: string, direction: -1 | 1): boolean {
  return applyOutlineMoveAction(editor, [blockId], direction < 0 ? 'move_up' : 'move_down');
}

export function moveOutlineSelection(
  editor: Editor,
  selectedIds: readonly string[],
  targetId: string,
  placement: OutlineDropPlacement,
  options: { expandTarget?: boolean } = {},
): boolean {
  if (!editor.isEditable || activeOutlineView(editor).composing) return false;
  const view = outlineViewState(editor.state);
  const roots = outlineSelectionRoots(editor.state.doc.toJSON(), selectedIds);
  if (!roots.length || !outlinePlacementWithinFocus(editor.state.doc, view, roots, targetId, placement)) return false;
  const next = moveOutlineStructure(editor.state.doc.toJSON(), roots, targetId, placement);
  if (!next) return false;
  const document = editor.schema.nodeFromJSON(next);
  if (document.eq(editor.state.doc)) return false;
  const source = roots.length === 1 ? itemById(editor.state, roots[0]) : null;
  const [fromOffset, toOffset] = source ? mainSelectionOffsets(source, editor.state.selection) : [0, 0];
  const folded = new Set(view.folded);
  if (placement === 'INSIDE' && options.expandTarget) folded.delete(targetId);
  const visible = new Set(outlineVisibleItems(document, { ...view, folded }).map((row) => row.id));
  const selected = view.selected.length ? roots.filter((id) => visible.has(id)) : [];
  // A drop into a collapsed parent stays collapsed. Keep the visible parent active
  // rather than leaving the caret and selection inside its hidden children.
  const focusId = visible.has(roots[0]) ? roots[0] : targetId;
  if (view.selected.length && !selected.length && visible.has(targetId)) selected.push(targetId);
  const nextView: OutlineViewState = {
    ...view,
    folded,
    selected,
    anchor: selected[0] ?? null,
    active: selected.includes(view.active ?? '') ? view.active : (selected.at(-1) ?? null),
    drag: null,
    drop: null,
  };
  const transaction = closeHistory(editor.state.tr).replaceWith(0, editor.state.doc.content.size, document.content);
  const position = locateItem(transaction.doc, focusId);
  if (position !== null) {
    const size = transaction.doc.nodeAt(position)?.firstChild?.content.size ?? 0;
    transaction.setSelection(
      TextSelection.create(
        transaction.doc,
        position + 2 + Math.min(visible.has(roots[0]) ? fromOffset : 0, size),
        position + 2 + Math.min(visible.has(roots[0]) ? toOffset : 0, size),
      ),
    );
  }
  transaction.setMeta('aiy:outline-structure-move', true);
  attachOutlineView(transaction, nextView, view);
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

function editOutlineSelection(editor: Editor) {
  const view = outlineViewState(editor.state);
  const id = view.active ?? view.selected.at(-1);
  if (!id) return false;
  const location = itemById(editor.state, id);
  if (!location) return false;
  const position = location.itemPos + 2 + (location.item.firstChild?.content.size ?? 0);
  const transaction = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position));
  attachOutlineView(transaction, { ...view, selected: [], anchor: null, active: null });
  editor.view.dispatch(transaction.setMeta('addToHistory', false));
  return true;
}

export function deleteOutlineSelection(editor: Editor) {
  if (!editor.isEditable || activeOutlineView(editor).composing) return false;
  const view = outlineViewState(editor.state);
  const json = editor.state.doc.toJSON();
  const roots = outlineSelectionRoots(json, view.selected);
  if (!roots.length || (view.focus && roots.includes(view.focus))) return false;
  const rows = outlineVisibleItems(editor.state.doc, view);
  const visible = new Set(rows.map((row) => row.id));
  if (roots.some((id) => !visible.has(id))) return false;
  const removed = new Set(roots);
  const survives = (row: (typeof rows)[number]) => !removed.has(row.id) && !row.ancestors.some((id) => removed.has(id));
  const firstIndex = rows.findIndex((row) => removed.has(row.id));
  const neighbor = rows.slice(0, firstIndex).filter(survives).at(-1) ?? rows.slice(firstIndex + 1).find(survives);
  const next = deleteOutlineStructure(json, roots);
  if (!next) return false;
  const document = editor.schema.nodeFromJSON(next);
  const fallback = outlineVisibleItems(document, view)[0]?.id ?? null;
  const focusId = neighbor?.id ?? view.focus ?? fallback;
  const transaction = closeHistory(editor.state.tr).replaceWith(0, editor.state.doc.content.size, document.content);
  const focusPosition = focusId ? locateItem(transaction.doc, focusId) : null;
  transaction.setSelection(
    focusPosition === null
      ? TextSelection.atStart(transaction.doc)
      : TextSelection.create(transaction.doc, focusPosition + 2),
  );
  const selected = focusId && focusId !== view.focus ? [focusId] : [];
  attachOutlineView(transaction, { ...view, selected, anchor: selected[0] ?? null, active: selected[0] ?? null }, view);
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export function shiftSelectedOutlineItems(editor: Editor, outdent: boolean) {
  return applyOutlineMoveAction(editor, outlineViewState(editor.state).selected, outdent ? 'outdent' : 'indent');
}

export function moveSelectedOutlineItemsByOne(editor: Editor, direction: -1 | 1) {
  return applyOutlineMoveAction(
    editor,
    outlineViewState(editor.state).selected,
    direction < 0 ? 'move_up' : 'move_down',
  );
}

/** Read-only capability checks: rendering a toolbar must never dispatch a command. */
export function outlineSelectionCapabilities(editor: Editor) {
  const view = outlineViewState(editor.state);
  const document = editor.state.doc.toJSON();
  const records = outlineItemRecords(document);
  const roots = outlineSelectionRoots(document, view.selected);
  const visible = new Set(outlineVisibleItems(editor.state.doc, view).map((row) => row.id));
  const usable =
    editor.isEditable &&
    !activeOutlineView(editor).composing &&
    roots.length > 0 &&
    roots.every((id) => visible.has(id));
  const mutable = usable && !roots.includes(view.focus ?? '');
  const branches = view.selected.filter((id) =>
    records.get(id)?.node.content?.some((child) => isOutlineChildList(child) && Boolean(child.content?.length)),
  );
  const canMoveTo =
    mutable &&
    [...outlineMoveTargets(document, roots)].some((targetId) =>
      (['BEFORE', 'AFTER', 'INSIDE'] as const).some((placement) =>
        outlinePlacementWithinFocus(editor.state.doc, view, roots, targetId, placement),
      ),
    );
  return {
    selectedCount: view.selected.length,
    branchCount: roots.length,
    canMoveUp: mutable && Boolean(outlineMovePlan(editor, view.selected, 'move_up')),
    canMoveDown: mutable && Boolean(outlineMovePlan(editor, view.selected, 'move_down')),
    canIndent: mutable && Boolean(outlineMovePlan(editor, view.selected, 'indent')),
    canOutdent: mutable && Boolean(outlineMovePlan(editor, view.selected, 'outdent')),
    canCollapse: usable && branches.some((id) => !view.folded.has(id)),
    canExpand: usable && branches.some((id) => view.folded.has(id)),
    canMoveTo,
    canDelete: mutable,
  };
}

/** Native item metadata; an explicit id leaves the user's text and node selection untouched. */
export function toggleOutlineTaskState(editor: Editor, blockId?: string): boolean {
  if (!editor.isEditable || activeOutlineView(editor).composing) return false;
  const view = outlineViewState(editor.state);
  const currentId = itemAt(editor.state, editor.state.selection.from)?.item.attrs.blockId;
  const ids = blockId
    ? [blockId]
    : view.selected.length
      ? outlineSelectionRoots(editor.state.doc.toJSON(), view.selected)
      : currentId
        ? [currentId]
        : [];
  const locations = ids.map((id) => itemById(editor.state, id));
  if (!locations.length || locations.some((location) => !location)) return false;
  const state = locations.every((location) => location!.item.attrs.taskState === 'TODO') ? 'DONE' : 'TODO';
  const transaction = closeHistory(editor.state.tr);
  for (const location of locations) {
    const { item, itemPos } = location!;
    transaction.setNodeMarkup(itemPos, undefined, { ...item.attrs, taskState: state });
  }
  attachOutlineView(transaction, view, view);
  editor.view.dispatch(transaction);
  return true;
}

function handleOutlineEscape(editor: Editor, event: KeyboardEvent) {
  const outline = outlineViewState(editor.state);
  if (outline.drag) {
    endOutlineDrag(editor);
    event.preventDefault();
    return true;
  }
  if (outline.selected.length > 1) {
    const id = outline.active ?? outline.selected.at(-1)!;
    setOutlineView(editor, { ...outline, selected: [id], anchor: id });
  } else if (outline.selected.length) {
    setOutlineView(editor, { ...outline, selected: [], anchor: null });
  } else {
    const location = itemAt(editor.state, editor.state.selection.from);
    if (location?.item.attrs.blockId) selectOutlineItem(editor, location.item.attrs.blockId);
    else if (outline.focus) {
      const path = outlineFocusPath(editor.state.doc, outline.focus);
      focusOutlineItem(editor, path.at(-2)?.id ?? null);
    } else return false;
  }
  event.preventDefault();
  return true;
}

function handleOutlineScopeShortcut(
  editor: Editor,
  event: KeyboardEvent,
  view: OutlineViewState,
  currentId: string | null,
  primary: boolean,
) {
  if (primary && !event.altKey && !event.shiftKey && (event.key === '.' || event.key === ',')) {
    event.preventDefault();
    if (event.key === '.') {
      if (currentId) focusOutlineItem(editor, currentId);
    } else if (view.focus) {
      const path = outlineFocusPath(editor.state.doc, view.focus);
      focusOutlineItem(editor, path.at(-2)?.id ?? null);
    }
    return true;
  }
  if (primary && !event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    if (view.selected.length) setSelectedOutlineItemsFolded(editor, event.key === 'ArrowUp');
    else if (currentId && view.folded.has(currentId) !== (event.key === 'ArrowUp'))
      toggleOutlineFold(editor, currentId);
    return true;
  }
  return false;
}

function handleOutlineSelectionShortcut(
  editor: Editor,
  event: KeyboardEvent,
  view: OutlineViewState,
  currentId: string | null,
  primary: boolean,
) {
  if (primary && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    setOutlineView(editor, {
      ...view,
      selected: outlineVisibleItems(editor.state.doc, view)
        .map((row) => row.id)
        .filter((id) => id !== view.focus),
      anchor: null,
    });
    return true;
  }
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.key === 'ArrowUp' || event.key === 'ArrowDown')
  ) {
    event.preventDefault();
    if (!view.selected.length) {
      if (currentId) selectOutlineItem(editor, currentId);
    } else {
      const rows = outlineVisibleItems(editor.state.doc, view);
      const index = rows.findIndex((row) => row.id === currentId);
      const next = rows[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (next && next.id !== view.focus) selectOutlineItem(editor, next.id, true);
    }
    return true;
  }
  return false;
}

function handleOutlineMoveShortcut(
  editor: Editor,
  event: KeyboardEvent,
  view: OutlineViewState,
  currentId: string | null,
  platform: string,
) {
  const matches =
    event.shiftKey &&
    (platform === 'darwin'
      ? event.metaKey && !event.ctrlKey && !event.altKey
      : (event.altKey && !event.ctrlKey && !event.metaKey) || (event.ctrlKey && !event.altKey && !event.metaKey));
  if (!matches || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false;
  event.preventDefault();
  const direction = event.key === 'ArrowUp' ? -1 : 1;
  if (view.selected.length) moveSelectedOutlineItemsByOne(editor, direction);
  else if (currentId) moveOutlineItem(editor, currentId, direction);
  return true;
}

function handleOutlineStructureShortcut(editor: Editor, event: KeyboardEvent) {
  const view = outlineViewState(editor.state);
  const platform = window.desktopApi?.appPlatform ?? 'win32';
  const primary = platform === 'darwin' ? event.metaKey : event.ctrlKey;
  const currentId =
    view.active ??
    view.selected.at(-1) ??
    itemAt(editor.state, editor.state.selection.from)?.item.attrs.blockId ??
    null;
  if (primary && !event.altKey && !event.shiftKey && event.key === 'Enter') {
    event.preventDefault();
    toggleOutlineTaskState(editor);
    return true;
  }
  return (
    handleOutlineScopeShortcut(editor, event, view, currentId, primary) ||
    handleOutlineSelectionShortcut(editor, event, view, currentId, primary) ||
    handleOutlineMoveShortcut(editor, event, view, currentId, platform)
  );
}

function handleOutlineSelectionKey(editor: Editor, event: KeyboardEvent) {
  const outline = outlineViewState(editor.state);
  if (!outline.selected.length) return false;
  if (event.key === 'Enter') {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (!event.shiftKey) editOutlineSelection(editor);
    else {
      const active = outline.active ?? outline.selected.at(-1)!;
      const location = itemById(editor.state, active);
      const hardBreak = editor.schema.nodes.hardBreak;
      if (location && hardBreak) {
        const position = location.itemPos + 2 + (location.item.firstChild?.content.size ?? 0);
        const transaction = closeHistory(editor.state.tr)
          .setSelection(TextSelection.create(editor.state.doc, position))
          .replaceSelectionWith(hardBreak.create());
        attachOutlineView(transaction, { ...outline, selected: [], anchor: null, active: null }, outline);
        editor.view.dispatch(transaction.scrollIntoView());
      }
    }
  } else if (event.key === 'Delete' || event.key === 'Backspace') deleteOutlineSelection(editor);
  else if (event.key === 'Tab') shiftSelectedOutlineItems(editor, event.shiftKey);
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const rows = outlineVisibleItems(editor.state.doc, outline);
    const active = outline.active ?? outline.selected.at(-1)!;
    const index = rows.findIndex((row) => row.id === active);
    const next = rows[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (next) selectOutlineItem(editor, next.id, event.shiftKey);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    const active = outline.active ?? outline.selected.at(-1)!;
    const location = itemById(editor.state, active);
    const range = location && firstParagraphRange(location);
    if (range) {
      const transaction = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from, range.to));
      attachOutlineView(transaction, { ...outline, selected: [], anchor: null, active: null });
      editor.view.dispatch(transaction.setMeta('addToHistory', false));
    }
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    editOutlineSelection(editor);
    return false;
  } else return false;
  event.preventDefault();
  return true;
}

function plainOutlineLeaf(item: ProseMirrorNode) {
  if (item.childCount !== 1 || item.firstChild?.type.name !== 'paragraph') return false;
  let plain = true;
  item.firstChild.descendants((node) => {
    if (!node.isText) plain = false;
  });
  return plain;
}

function handleOutlineBoundaryDelete(editor: Editor, event: KeyboardEvent) {
  if (!['Backspace', 'Delete'].includes(event.key) || !editor.state.selection.empty) return false;
  const location = itemAt(editor.state, editor.state.selection.from);
  const range = location && firstParagraphRange(location);
  if (!location || !range) return false;
  const backward = event.key === 'Backspace';
  if (editor.state.selection.from !== (backward ? range.from : range.to)) return false;
  if (outlineViewState(editor.state).focus === location.item.attrs.blockId) {
    event.preventDefault();
    return true;
  }
  const neighborIndex = location.index + (backward ? -1 : 1);
  const neighbor =
    neighborIndex >= 0 && neighborIndex < location.list.childCount ? location.list.child(neighborIndex) : null;
  if (backward && !location.item.firstChild?.content.size && location.item.childCount === 1) {
    if (location.listDepth > 1 && !neighbor) {
      outdentOutlineItem(editor, location.item.attrs.blockId);
      event.preventDefault();
      return true;
    }
    if (neighbor) {
      const transaction = editor.state.tr.delete(location.itemPos, location.itemPos + location.item.nodeSize);
      transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(Math.min(location.itemPos, transaction.doc.content.size)), -1),
      );
      editor.view.dispatch(transaction.scrollIntoView());
      event.preventDefault();
      return true;
    }
  }
  const outerEdge = location.listDepth === 1 && !neighbor;
  if (!outerEdge && neighbor && plainOutlineLeaf(location.item) && plainOutlineLeaf(neighbor)) return false;
  event.preventDefault();
  return true;
}

function handleOutlineEnter(editor: Editor, event: Event) {
  const { state } = editor;
  const location = itemAt(state, state.selection.from);
  if (!location || state.selection.$from.parent.type.name !== 'paragraph') return false;
  // Consume input before dispatching so a failed command cannot fall through to liftEmptyBlock.
  event.preventDefault();
  if (!state.selection.$from.sameParent(state.selection.$to)) {
    const ending = itemAt(state, state.selection.to);
    const first = firstParagraphRange(location);
    const last = ending && firstParagraphRange(ending);
    if (
      !ending ||
      !first ||
      !last ||
      location.listPos !== ending.listPos ||
      ending.index <= location.index ||
      state.selection.from < first.from ||
      state.selection.to > last.to
    )
      return true;
    const items = siblings(location);
    const before = location.item.firstChild!.content.cut(0, state.selection.from - first.from);
    const after = ending.item.firstChild!.content.cut(state.selection.to - last.from);
    const kept = location.item.copy(Fragment.from(location.item.firstChild!.copy(before)));
    const remaining = Array.from({ length: ending.item.childCount - 1 }, (_, index) => ending.item.child(index + 1));
    const endingItem = ending.item.copy(Fragment.fromArray([ending.item.firstChild!.copy(after), ...remaining]));
    items.splice(location.index, ending.index - location.index + 1, kept, endingItem);
    commitList(editor, location, items, endingItem.attrs.blockId);
    return true;
  }
  if (!splitOutlineItem(editor)) splitOutlineNote(editor);
  return true;
}

function handleOutlineWritingKey(editor: Editor, event: KeyboardEvent) {
  if (handleOutlineBoundaryDelete(editor, event)) return true;
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey)
    return handleOutlineEnter(editor, event);
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return false;
  // Tab is a structure command in this canvas, including when a move has no legal target.
  // Consume it before trying the command so the browser cannot focus a neighboring control.
  event.preventDefault();
  const location = itemAt(editor.state, editor.state.selection.from);
  const range = location && firstParagraphRange(location);
  if (!location) {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const type = $from.node(depth).type.name;
      if (type !== 'listItem' && type !== 'taskItem') continue;
      if (event.shiftKey) editor.commands.liftListItem(type);
      else editor.commands.sinkListItem(type);
      break;
    }
    return true;
  }
  if (!range || editor.state.selection.from < range.from || editor.state.selection.to > range.to) return true;
  if (event.shiftKey) outdentOutlineItem(editor, location.item.attrs.blockId);
  else indentOutlineItem(editor, location.item.attrs.blockId);
  return true;
}

export const OutlineEditing = Extension.create({
  name: 'outlineEditing',
  priority: 1_100,
  addKeyboardShortcuts() {
    // These format commands can lift the mandatory first paragraph out of its list item.
    return Object.fromEntries(
      [
        'Mod-Shift-7',
        'Mod-Shift-8',
        'Mod-Shift-9',
        'Mod-Shift-b',
        'Mod-Alt-c',
        ...Array.from({ length: 7 }, (_, level) => `Mod-Alt-${level}`),
      ].map((shortcut) => [shortcut, () => selectionInOutlineTitle(this.editor.state)]),
    );
  },
  addProseMirrorPlugins() {
    return [
      OutlineView,
      new Plugin({
        appendTransaction: (transactions, oldState, state) => {
          if (
            activeOutlineView(this.editor).composing ||
            !transactions.some((transaction) => transaction.docChanged) ||
            transactions.some((transaction) => transaction.getMeta('composition') !== undefined)
          )
            return null;
          return continueOutlineLists(oldState, state);
        },
        props: {
          handleDOMEvents: {
            compositionstart: (view) => {
              rememberOutlineView(this.editor, view);
              return false;
            },
            keydown: (view, event) => {
              rememberOutlineView(this.editor, view);
              // handleKeyDown's true result makes ProseMirror call preventDefault.
              // Stop composing keys at the DOM hook to keep native IME confirmation intact.
              return event.isComposing || event.keyCode === 229 || view.composing;
            },
            beforeinput: (view, event) => {
              rememberOutlineView(this.editor, view);
              if (
                event.inputType !== 'insertParagraph' ||
                !event.cancelable ||
                event.isComposing ||
                view.composing ||
                !this.editor.isEditable
              )
                return false;
              return handleOutlineEnter(this.editor, event);
            },
            copy: (view, event) => {
              rememberOutlineView(this.editor, view);
              if (!outlineViewState(this.editor.state).selected.length) return false;
              if (!copyOutlineSelection(this.editor, event)) event.preventDefault();
              return true;
            },
            cut: (view, event) => {
              rememberOutlineView(this.editor, view);
              if (!outlineViewState(this.editor.state).selected.length) return false;
              if (this.editor.isEditable && copyOutlineSelection(this.editor, event))
                deleteOutlineSelection(this.editor);
              else event.preventDefault();
              return true;
            },
            paste: (view, event) => {
              rememberOutlineView(this.editor, view);
              if (pasteOutlineSelection(this.editor, event)) return true;
              if (pasteExternalOutlineText(this.editor, event)) return true;
              if (outlineViewState(this.editor.state).selected.length) {
                if (event.clipboardData?.getData('text/plain')) editOutlineSelection(this.editor);
                else {
                  event.preventDefault();
                  return true;
                }
              }
              return false;
            },
          },
          handleKeyDown: (view, event) => {
            rememberOutlineView(this.editor, view);
            // Let native buttons handle Enter/Space without the editor interpreting them as text input.
            if (event.target instanceof Element && event.target.closest('[data-outline-control]')) return true;
            if (!this.editor.isEditable) return false;
            // Stop lower-priority editor keymaps without cancelling the IME's native confirmation.
            if (event.isComposing || event.keyCode === 229 || view.composing) return true;
            if (event.key === 'Enter' && event.repeat) {
              event.preventDefault();
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab' || event.key.startsWith('Arrow'))
              synchronizeContentEditorSelectionFromDom(this.editor, view);
            if (
              (event.ctrlKey || event.metaKey) &&
              !event.altKey &&
              !event.shiftKey &&
              event.key.toLowerCase() === 'a' &&
              !outlineViewState(this.editor.state).selected.length
            ) {
              const { state } = this.editor;
              const { $from } = state.selection;
              if ($from.parent.isTextblock) {
                event.preventDefault();
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end())));
                return true;
              }
            }
            if (selectionInOutlineTitle(this.editor.state)) {
              for (let level = 2; level <= 6; level += 1) {
                if (
                  commandMatchesShortcut(event, window.desktopApi?.appPlatform ?? 'win32', `format.heading.${level}`)
                ) {
                  event.preventDefault();
                  return true;
                }
              }
            }
            if (event.key === 'Escape') return handleOutlineEscape(this.editor, event);
            if (handleOutlineStructureShortcut(this.editor, event)) return true;
            if (outlineViewState(this.editor.state).selected.length)
              return handleOutlineSelectionKey(this.editor, event);
            if (handleOutlineArrow(this.editor, view, event)) return true;
            return handleOutlineWritingKey(this.editor, event);
          },
        },
      }),
    ];
  },
});
