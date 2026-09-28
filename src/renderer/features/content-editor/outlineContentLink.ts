import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { activeOutlineView, focusOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { attachOutlineView, outlineViewState } from '@/renderer/features/content-editor/outlineViewState';

export function outlineLinkItem(editor: Editor, blockId: string) {
  if (editor.isDestroyed) return null;
  const matches: { node: ProseMirrorNode; position: number }[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'listItem' && node.attrs.blockId === blockId) matches.push({ node, position });
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Insert one link into this item's notes without replacing its title, notes or descendants. */
export function insertOutlineContentLink(editor: Editor, blockId: string, href: string, title: string): boolean {
  if (editor.isDestroyed || !editor.isEditable || activeOutlineView(editor).composing) return false;
  const item = outlineLinkItem(editor, blockId);
  if (!item || !editor.schema.marks.link) return false;
  let linked = false;
  item.node.forEach((child) => {
    if (['bulletList', 'orderedList', 'taskList'].includes(child.type.name) && child.attrs.outlineRole !== 'NOTE')
      return;
    child.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'link' && mark.attrs.href === href)) linked = true;
    });
  });
  if (linked) return true;
  const position = item.position + 1 + (item.node.firstChild?.nodeSize ?? 0);
  const paragraph = editor.schema.nodes.paragraph.create(
    { blockId: crypto.randomUUID() },
    editor.schema.text(title || href, [editor.schema.marks.link.create({ href })]),
  );
  const transaction = closeHistory(editor.state.tr).insert(position, paragraph);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + paragraph.nodeSize - 1)));
  const previous = outlineViewState(editor.state);
  const folded = new Set(previous.folded);
  folded.delete(blockId);
  attachOutlineView(transaction, { ...previous, folded, selected: [], anchor: null, active: null }, previous);
  editor.view.dispatch(transaction.setMeta('preventAutolink', true).scrollIntoView());
  // Following input starts another history group; undoing the link never discards earlier typing.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  focusOutlineView(editor);
  return true;
}
