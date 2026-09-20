import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';

/** Delete one empty leaf, not a list boundary or a parent with hidden children. */
export function deleteEmptyListLeaf(editor: Editor, direction: -1 | 1): boolean {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return false;
  const { state, view } = editor;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  if ($from.depth < 3 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false;
  const itemDepth = $from.depth - 1;
  const item = $from.node(itemDepth);
  const list = $from.node(itemDepth - 1);
  const validPair =
    (item.type.name === 'listItem' && ['bulletList', 'orderedList'].includes(list.type.name)) ||
    (item.type.name === 'taskItem' && list.type.name === 'taskList');
  if (!validPair || item.childCount !== 1 || list.childCount < 2) return false;
  const start = $from.before(itemDepth);
  const transaction = closeHistory(state.tr).delete(start, start + item.nodeSize);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(start), direction));
  view.dispatch(transaction.scrollIntoView());
  return true;
}
