import type { Editor } from '@tiptap/core';
import { revealOutlinePosition } from '@/renderer/features/content-editor/outlineViewState';

const pending = new WeakMap<Editor, () => void>();

export function cancelEditorSearchReveal(editor: Editor) {
  pending.get(editor)?.();
}

/** Wait for folded NodeViews and scope restoration; only the latest request may scroll. */
export function revealEditorSearchMatch(editor: Editor, position: number, selector: string, onReveal?: () => void) {
  cancelEditorSearchReveal(editor);
  if (editor.isDestroyed || editor.view.composing) return;
  const document = editor.state.doc;
  revealOutlinePosition(editor, position);
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (pending.get(editor) !== cancel) return;
      pending.delete(editor);
      if (editor.isDestroyed || editor.view.composing || editor.state.doc !== document) return;
      const element = editor.view.dom.querySelector<HTMLElement>(selector);
      if (!element) return;
      element.scrollIntoView({
        behavior: 'instant',
        block: 'center',
        inline: 'nearest',
      });
      onReveal?.();
    });
  });
  const cancel = () => {
    cancelAnimationFrame(frame);
    if (pending.get(editor) === cancel) pending.delete(editor);
  };
  pending.set(editor, cancel);
  return cancel;
}
