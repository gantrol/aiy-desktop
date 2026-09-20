import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { contentFigureReferenceAssetId, contentFigureReferenceUrl } from '@/shared/content-figure-reference';
import type { Locale } from '@/shared/contracts';
import { figureReferenceMessages } from '@/shared/i18n/figure-reference';

interface FigureReferenceRange {
  assetId: string;
  from: number;
  to: number;
  label: string;
  marks: readonly Mark[];
}

export function contentFigureReferenceRanges(document: ProseMirrorNode): FigureReferenceRange[] {
  const ranges: FigureReferenceRange[] = [];
  document.descendants((node, position) => {
    if (!node.isText) return;
    const link = node.marks.find((mark) => mark.type.name === 'link');
    const assetId = contentFigureReferenceAssetId(typeof link?.attrs.href === 'string' ? link.attrs.href : '');
    if (!assetId) return;
    const previous = ranges.at(-1);
    if (previous && previous.assetId === assetId && previous.to === position) {
      previous.to += node.nodeSize;
      previous.label += node.text ?? '';
    } else {
      ranges.push({ assetId, from: position, to: position + node.nodeSize, label: node.text ?? '', marks: node.marks });
    }
  });
  return ranges;
}

/** Bound labels follow the attachment order; ordinary prose and handwritten figure numbers are untouched. */
export function refreshContentFigureReferenceLabels(
  editor: Editor,
  assetIds: readonly string[],
  labelAtIndex: (index: number) => string,
  missingLabel: string,
): boolean {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return false;
  const order = new Map([...new Set(assetIds)].map((assetId, index) => [assetId, index]));
  const transaction = editor.state.tr;
  for (const range of contentFigureReferenceRanges(editor.state.doc).reverse()) {
    const index = order.get(range.assetId);
    const label = index === undefined ? missingLabel : labelAtIndex(index);
    if (range.label === label || !label) continue;
    transaction.replaceWith(range.from, range.to, editor.schema.text(label, range.marks));
  }
  if (!transaction.docChanged) return false;
  transaction.setMeta('addToHistory', false).setMeta('preventAutolink', true);
  editor.view.dispatch(transaction);
  return true;
}

/** Insert after a selection, preserving its text or image. The parentheses are outside the link mark. */
export function insertContentFigureReference(editor: Editor, assetId: string, label: string, locale: Locale): boolean {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing || !assetId || !label.trim()) return false;
  const link = editor.schema.marks.link;
  if (!link) return false;
  const href = contentFigureReferenceUrl(assetId);
  if (!contentFigureReferenceAssetId(href)) return false;
  const copy = figureReferenceMessages(locale);
  const content = Fragment.fromArray([
    editor.schema.text(copy.opening),
    editor.schema.text(label, [link.create({ href })]),
    editor.schema.text(copy.closing),
  ]);
  const { to, $to } = editor.state.selection;
  const transaction = editor.state.tr;
  if ($to.parent.inlineContent) {
    if (!$to.parent.type.allowsMarkType(link)) return false;
    transaction.setSelection(TextSelection.create(transaction.doc, to));
    transaction.replaceSelection(new Slice(content, 0, 0));
  } else {
    const paragraph = editor.schema.nodes.paragraph;
    if (!paragraph || !$to.parent.canReplaceWith($to.index(), $to.index(), paragraph)) return false;
    transaction.insert(to, paragraph.create(null, content));
    transaction.setSelection(TextSelection.create(transaction.doc, to + 1 + content.size));
  }
  transaction.setStoredMarks([]).setMeta('preventAutolink', true);
  editor.view.dispatch(transaction.scrollIntoView());
  // Let the image menu finish closing before the editor takes focus again.
  editor.commands.focus(undefined, { scrollIntoView: false });
  return true;
}

export function revealContentFigureReference(editor: Editor, assetId: string): boolean {
  if (editor.isDestroyed || editor.view.composing) return false;
  let target: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (target === undefined && node.type.name === 'image' && node.attrs.assetId === assetId) target = position;
  });
  return target !== undefined && editor.chain().setNodeSelection(target).scrollIntoView().run();
}
