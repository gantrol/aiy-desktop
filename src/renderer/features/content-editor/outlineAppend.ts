import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { isOutlineChildList } from '@/shared/outline-structure';
import { outlineViewState, setOutlineView } from '@/renderer/features/content-editor/outlineViewState';

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
