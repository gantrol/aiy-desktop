import { activeOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { itemAt, itemById, freshOutlineItem } from '@/renderer/features/content-editor/outlineItemLocation';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { isOutlineChildList } from '@/shared/outline-structure';
import {
  attachOutlineView,
  outlineViewState,
  setOutlineView,
} from '@/renderer/features/content-editor/outlineViewState';

/** Paragraphs belong to the current item; creating one never creates a structural child. */
export function addOutlineParagraph(editor: Editor, blockId?: string, splitAtCursor = false): boolean {
  if (!editor.isEditable || editor.isDestroyed || activeOutlineView(editor).composing) return false;
  const previous = outlineViewState(editor.state);
  const id = blockId ?? previous.active ?? previous.selected.at(-1);
  const location = id ? itemById(editor.state, id) : itemAt(editor.state, editor.state.selection.from);
  if (!location) return false;
  const folded = new Set(previous.folded);
  folded.delete(location.item.attrs.blockId);
  const next = { ...previous, folded, selected: [], anchor: null, active: null };
  const { $from, $to } = editor.state.selection;
  if (
    splitAtCursor &&
    !previous.selected.length &&
    $from.sameParent($to) &&
    $from.parent.type.name === 'paragraph' &&
    $from.depth === location.listDepth + 2 &&
    itemAt(editor.state, $from.pos)?.itemPos === location.itemPos
  ) {
    return editor
      .chain()
      .splitBlock()
      .command(({ tr }) => {
        attachOutlineView(tr, next, previous);
        return true;
      })
      .run();
  }
  let target = location.itemPos + 1 + location.item.firstChild!.nodeSize;
  let foundCursor = false;
  location.item.forEach((child, offset) => {
    const start = location.itemPos + 1 + offset;
    if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) return;
    if (!foundCursor) target = start + child.nodeSize;
    if (!previous.selected.length && $from.pos >= start && $from.pos < start + child.nodeSize) {
      target = start + child.nodeSize;
      foundCursor = true;
    }
  });
  const transaction = editor.state.tr.insert(
    target,
    editor.schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }),
  );
  transaction.setSelection(TextSelection.create(transaction.doc, target + 1));
  editor.view.dispatch(attachOutlineView(transaction, next, previous).scrollIntoView());
  return true;
}

/** Explicit next-item action works from titles, notes and media without splitting their content. */
export function addOutlineItem(editor: Editor, blockId?: string, removeEmptyNote = false): boolean {
  if (!editor.isEditable || editor.isDestroyed || activeOutlineView(editor).composing) return false;
  const previous = outlineViewState(editor.state);
  const id = blockId ?? previous.active ?? previous.selected.at(-1);
  const location = id ? itemById(editor.state, id) : itemAt(editor.state, editor.state.selection.from);
  if (!location) return false;
  const transaction = editor.state.tr;
  if (removeEmptyNote) {
    const { $from } = editor.state.selection;
    transaction.delete($from.before(), $from.after());
  }
  const added = freshOutlineItem(editor);
  let target = location.itemPos + location.item.nodeSize;
  const folded = new Set(previous.folded);
  if (previous.focus === location.item.attrs.blockId) {
    let groupEnd: number | null = null;
    location.item.forEach((child, offset) => {
      if (isOutlineChildList({ type: child.type.name, attrs: child.attrs }))
        groupEnd = location.itemPos + 1 + offset + child.nodeSize - 1;
    });
    target = transaction.mapping.map(groupEnd ?? target - 1);
    transaction.insert(
      target,
      groupEnd === null
        ? editor.schema.nodes.bulletList.create({ blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' }, added)
        : added,
    );
    if (groupEnd === null) target += 1;
    folded.delete(location.item.attrs.blockId);
  } else {
    target = transaction.mapping.map(target);
    transaction.insert(target, added);
  }
  transaction.setSelection(TextSelection.create(transaction.doc, target + 2));
  editor.view.dispatch(
    attachOutlineView(
      transaction,
      {
        ...previous,
        folded,
        selected: [],
        anchor: null,
        active: null,
      },
      previous,
    ).scrollIntoView(),
  );
  return true;
}

export function appendOutlineItem(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return false;
  const { state, schema } = editor;
  const view = outlineViewState(state);
  let scope: ProseMirrorNode = state.doc;
  let contentStart = 0;
  if (view.focus) {
    let found = false;
    state.doc.descendants((node, position) => {
      if (found) return false;
      if (node.type.name !== 'listItem' || node.attrs.blockId !== view.focus) return;
      scope = node;
      contentStart = position + 1;
      found = true;
      return false;
    });
    if (!found) return false;
  }
  let listEnd: number | null = null;
  scope.forEach((child, offset) => {
    if (
      offset + child.nodeSize === scope.content.size &&
      isOutlineChildList({ type: child.type.name, attrs: child.attrs })
    )
      listEnd = contentStart + offset + child.nodeSize - 1;
  });
  const item = schema.nodes.listItem.create(
    { blockId: crypto.randomUUID() },
    schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }),
  );
  const transaction = state.tr;
  let itemPosition: number;
  if (listEnd !== null) {
    itemPosition = listEnd;
    transaction.insert(listEnd, item);
  } else {
    const position = contentStart + scope.content.size;
    transaction.insert(
      position,
      schema.nodes.bulletList.create({ blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' }, item),
    );
    itemPosition = position + 1;
  }
  transaction.setSelection(TextSelection.create(transaction.doc, itemPosition + 2));
  editor.view.dispatch(transaction.scrollIntoView());
  const current = outlineViewState(editor.state);
  const folded = new Set(current.folded);
  if (view.focus) folded.delete(view.focus);
  setOutlineView(editor, { ...current, folded, selected: [], anchor: null });
  editor.view.focus();
  return true;
}
