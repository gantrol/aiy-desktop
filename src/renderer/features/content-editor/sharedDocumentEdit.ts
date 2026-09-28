import type { Editor } from '@tiptap/core';
import type { Node, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { BlockDocument } from '@/shared/contracts/block-document';

/** A minimal replacement maps selections, comments and existing undo entries through remote edits. */
export function sharedDocumentTransaction(transaction: Transaction, next: Node) {
  const before = transaction.doc;
  const start = before.content.findDiffStart(next.content);
  if (start === null) return transaction;
  const end = before.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(end.a, end.b);
  const fromEnd = end.a + Math.max(0, overlap);
  const toEnd = end.b + Math.max(0, overlap);
  return transaction.replace(start, fromEnd, next.slice(start, toEnd)).setMeta('addToHistory', false);
}

export function sameSharedDocument(schema: Schema, first: BlockDocument, second: BlockDocument) {
  return schema.nodeFromJSON(first.root).eq(schema.nodeFromJSON(second.root));
}

export function applySharedDocument(editor: Editor, before: BlockDocument, next: BlockDocument) {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return false;
  if (!editor.state.doc.eq(editor.schema.nodeFromJSON(before.root))) return false;
  const document = editor.schema.nodeFromJSON(next.root);
  document.check();
  editor.view.dispatch(sharedDocumentTransaction(editor.state.tr, document));
  return true;
}
