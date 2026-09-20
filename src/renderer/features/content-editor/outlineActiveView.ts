import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

const activeViews = new WeakMap<Editor, EditorView>();

/** The same document may be edited through either side of a split workspace. */
export function rememberOutlineView(editor: Editor, view: EditorView) {
  if (!view.isDestroyed) activeViews.set(editor, view);
}

export function forgetOutlineView(editor: Editor, view: EditorView) {
  if (activeViews.get(editor) === view) activeViews.delete(editor);
}

export function activeOutlineView(editor: Editor): EditorView {
  const view = activeViews.get(editor);
  return view && !view.isDestroyed ? view : editor.view;
}

export function focusOutlineView(editor: Editor, preferred = activeOutlineView(editor)) {
  if (editor.isDestroyed) return;
  const view = preferred.isDestroyed ? activeOutlineView(editor) : preferred;
  rememberOutlineView(editor, view);
  view.focus();
}
