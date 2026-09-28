import type { Editor } from '@tiptap/core';
import {
  focusOutlineItem,
  outlineFocusPath,
  outlineNavigationFocus,
} from '@/renderer/features/content-editor/outlineViewState';

/** Replaying navigation must not append another history entry. Missing scopes fall back to the whole outline. */
export function restoreOutlineNavigationFocus(editor: Editor, id: string | null | undefined) {
  const current = outlineNavigationFocus(editor.state);
  if (id === undefined || current === undefined) return false;
  const target = id && outlineFocusPath(editor.state.doc, id).length ? id : null;
  if (current === target) return false;
  focusOutlineItem(editor, target, false);
  return outlineNavigationFocus(editor.state) !== current;
}

export function afterOutlineFocusRestored(editor: Editor, reveal: () => void) {
  const focus = outlineNavigationFocus(editor.state);
  requestAnimationFrame(() => {
    if (!editor.isDestroyed && outlineNavigationFocus(editor.state) === focus) reveal();
  });
}
