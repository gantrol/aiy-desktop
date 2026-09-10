import type { Editor } from '@tiptap/core';

/** A duplicated placeholder shares the import, but keeps its own placement identity. */
export function hasContentImageImport(editor: Editor, importId: string) {
  if (editor.isDestroyed) return false;
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' && node.attrs.importId === importId) found = true;
    return !found;
  });
  return found;
}

export function updateContentImageImport(editor: Editor, importId: string, attributes: Record<string, unknown>) {
  if (editor.isDestroyed) return;
  const transaction = editor.state.tr;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'image' && node.attrs.importId === importId)
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...attributes });
  });
  if (transaction.docChanged) editor.view.dispatch(transaction.setMeta('addToHistory', false));
}
