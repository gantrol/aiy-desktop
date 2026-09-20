import { getMarkRange, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface InlineLinkTarget {
  href: string;
  from: number;
  to: number;
  document: ProseMirrorNode;
}

/** Resolve a mark in its actual paragraph/cell/list item, never via the document's first level. */
export function inlineLinkAt(editor: Editor, position: number, href?: string): InlineLinkTarget | null {
  if (editor.isDestroyed || !editor.schema.marks.link || position < 0 || position > editor.state.doc.content.size)
    return null;
  const document = editor.state.doc;
  const range = getMarkRange(document.resolve(position), editor.schema.marks.link, href ? { href } : undefined);
  if (!range) return null;
  const mark = document.nodeAt(range.from)?.marks.find((value) => value.type === editor.schema.marks.link);
  const address = mark?.attrs.href;
  return typeof address === 'string' ? { ...range, href: address, document } : null;
}

export function inlineLinkFromElement(editor: Editor, target: Element | null): InlineLinkTarget | null {
  const anchor = target?.closest('a[href]');
  if (!anchor || !editor.view.dom.contains(anchor) || anchor.closest('[data-aiy-link-card]')) return null;
  try {
    return inlineLinkAt(editor, editor.view.posAtDOM(anchor, 0), anchor.getAttribute('href') ?? undefined);
  } catch {
    return null;
  }
}

/** Refuse stale positions instead of editing a different link after an asynchronous document update. */
export function updateInlineLink(editor: Editor, target: InlineLinkTarget, href: string | null): boolean {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing || editor.state.doc !== target.document)
    return false;
  const type = editor.schema.marks.link;
  const current = inlineLinkAt(editor, target.from, target.href);
  if (!current || current.from !== target.from || current.to !== target.to) return false;
  const attributes = editor.state.doc.nodeAt(target.from)?.marks.find((mark) => mark.type === type)?.attrs ?? {};
  const transaction = editor.state.tr.removeMark(target.from, target.to, type).removeStoredMark(type);
  if (href !== null) transaction.addMark(target.from, target.to, type.create({ ...attributes, href }));
  transaction.setMeta('preventAutolink', true);
  editor.view.dispatch(transaction);
  editor.view.focus();
  return true;
}
