import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { captureBlockDocument } from '@/shared/contracts/block-document';
import type { DocumentWritingTask } from '@/shared/contracts/document-assistant';
import { documentWritingCandidate } from '@/shared/document-writing';

export function documentWritingSelection(editor: Editor | null): DocumentWritingTask['selection'] {
  if (!editor || editor.isDestroyed || editor.view.composing) return null;
  const selection = editor.state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  let containsAtom = false;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isAtom && !node.isText && node.type.name !== 'hardBreak') containsAtom = true;
  });
  const text = editor.state.doc.textBetween(selection.from, selection.to, '\n');
  if (containsAtom || !text.trim()) return null;
  return { from: selection.from, to: selection.to, text };
}

export function captureDocumentWritingTask(
  editor: Editor | null,
  kind: DocumentWritingTask['kind'],
): DocumentWritingTask {
  if (!editor || editor.isDestroyed || editor.view.composing) throw new Error('EDITOR_INPUT_UNSETTLED');
  const selection = kind === 'rewrite' ? documentWritingSelection(editor) : null;
  if (kind === 'rewrite' && !selection) throw new Error('DOCUMENT_WRITING_SELECT_TEXT');
  return { kind, baseDocument: captureBlockDocument(editor.getJSON()), selection };
}

export function applyDocumentWritingCandidate(
  editor: Editor | null,
  task: DocumentWritingTask,
  markdown: string,
  placement: 'replace' | 'append',
) {
  if (!editor || editor.isDestroyed || editor.view.composing) return false;
  if (
    placement === 'replace' &&
    JSON.stringify(captureBlockDocument(editor.getJSON())) !== JSON.stringify(task.baseDocument)
  )
    return false;
  if (placement === 'replace' && task.selection) {
    const { from, to, text } = task.selection;
    if (
      from < 0 ||
      to > editor.state.doc.content.size ||
      to <= from ||
      editor.state.doc.textBetween(from, to, '\n') !== text
    )
      return false;
  }
  const document = documentWritingCandidate(markdown);
  const range =
    placement === 'append'
      ? editor.state.doc.content.size
      : (task.selection ?? { from: 0, to: editor.state.doc.content.size });
  // Keep one candidate adoption separate from the author's preceding typing.
  editor.view.dispatch(closeHistory(editor.state.tr));
  const applied = editor.commands.insertContentAt(range, document.root.content ?? []);
  editor.view.dispatch(closeHistory(editor.state.tr));
  return applied;
}
