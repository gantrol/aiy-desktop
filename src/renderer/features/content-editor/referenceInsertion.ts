import type { Editor } from '@tiptap/core';
import { TextSelection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import type { Slice } from '@tiptap/pm/model';

/** A menu owns its original selection, not whichever editor happens to be focused when IPC finishes. */
export function captureReferenceInsertion(editor: Editor, position?: number) {
  const initial =
    position === undefined ? editor.state.selection : TextSelection.near(editor.state.doc.resolve(position));
  let bookmark: SelectionBookmark = initial.getBookmark();
  const selected: Slice = initial.content();
  let valid = !editor.isDestroyed && editor.isEditable && !editor.view.composing;
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!valid || !transaction.docChanged) return;
    try {
      const selection = bookmark.resolve(transaction.before);
      const from = transaction.mapping.mapResult(selection.from, 1);
      const to = transaction.mapping.mapResult(selection.to, selection.empty ? 1 : -1);
      if (from.deletedAcross || to.deletedAcross) valid = false;
      bookmark = bookmark.map(transaction.mapping);
      if (!selection.empty && !bookmark.resolve(transaction.doc).content().eq(selected)) valid = false;
    } catch {
      valid = false;
    }
  };
  editor.on('transaction', onTransaction);
  return {
    selection() {
      if (!valid || editor.isDestroyed || !editor.isEditable || editor.view.composing)
        throw new Error('REFERENCE_TARGET_CHANGED');
      return bookmark.resolve(editor.state.doc);
    },
    dispose() {
      valid = false;
      editor.off('transaction', onTransaction);
    },
  };
}
