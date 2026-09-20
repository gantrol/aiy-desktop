import type { Editor } from '@tiptap/core';
import { contentFigureReferenceRanges } from '@/renderer/features/content-editor/contentFigureReference';

/** Attachment removal may remove bound figure references; deleting one placement never does. */
export function removeContentImageAssets(editor: Editor, assetIds: readonly string[], removeReferences = false) {
  if (editor.isDestroyed || !editor.isEditable || (removeReferences && editor.view.composing)) return false;
  const targets = new Set(assetIds);
  const ranges: { from: number; to: number }[] = [];
  const document = editor.state.doc;
  document.descendants((node, position) => {
    if (node.type.name === 'image' && targets.has(String(node.attrs.assetId ?? '')))
      ranges.push({ from: position, to: position + node.nodeSize });
  });
  if (removeReferences) {
    for (const reference of contentFigureReferenceRanges(document)) {
      if (!targets.has(reference.assetId)) continue;
      let { from, to } = reference;
      const opening = document.textBetween(Math.max(0, from - 1), from);
      const closing = document.textBetween(to, Math.min(document.content.size, to + 1));
      if ((opening === '(' && closing === ')') || (opening === '（' && closing === '）')) {
        from--;
        to++;
      }
      ranges.push({ from, to });
    }
  }
  const transaction = editor.state.tr;
  for (const range of ranges.sort((left, right) => right.from - left.from)) transaction.delete(range.from, range.to);
  if (transaction.docChanged) editor.view.dispatch(transaction);
  return true;
}
