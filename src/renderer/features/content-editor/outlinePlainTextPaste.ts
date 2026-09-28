import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { DesktopPlatform } from '@/shared/contracts';
import { isOutlineChildList } from '@/shared/outline-structure';
import { matchesShortcut, type ShortcutBinding } from '@/renderer/commands/app-shortcuts';
import { activeOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { itemById } from '@/renderer/features/content-editor/outlineItemLocation';
import { attachOutlineView, outlineViewState } from '@/renderer/features/content-editor/outlineViewState';
import { plainTextInlineContent } from '@/renderer/features/content-editor/contentPlainText';
import { synchronizeContentEditorSelectionFromDom } from '@/renderer/features/content-editor/contentEditorKeyboard';

const pendingPastes = new WeakSet<Editor>();

export function outlinePlainTextPasteBinding(platform: DesktopPlatform): ShortcutBinding {
  return { key: 'v', shift: true, ...(platform === 'darwin' ? { meta: true } : { ctrl: true }) };
}

export function handleOutlinePlainTextPaste(editor: Editor, view: EditorView, event: KeyboardEvent): boolean {
  if (!matchesShortcut(event, outlinePlainTextPasteBinding(window.desktopApi?.appPlatform ?? 'win32'))) return false;
  // Consume even unavailable/failed commands so native paste cannot split the outline instead.
  event.preventDefault();
  if (!event.repeat) {
    if (!outlineViewState(editor.state).selected.length) synchronizeContentEditorSelectionFromDom(editor, view);
    void pasteOutlinePlainTextFromClipboard(editor);
  }
  return true;
}

function plainTextPasteSelection(editor: Editor, blockId?: string): TextSelection | null {
  if (editor.isDestroyed || !editor.isEditable || activeOutlineView(editor).composing) return null;
  const { state } = editor;
  const outline = outlineViewState(state);
  if (outline.selected.length > 1) return null;
  const { selection } = state;
  // Cross-block text ranges must not silently merge items or remove their children.
  if (!outline.selected.length && selection instanceof TextSelection && !selection.$from.sameParent(selection.$to))
    return null;
  const id = blockId ?? outline.selected[0];
  if (id) {
    const location = itemById(state, id);
    if (!location) return null;
    if (!outline.selected.length && selection instanceof TextSelection) {
      let belongs = false;
      location.item.forEach((child, offset) => {
        if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) return;
        const start = location.itemPos + 1 + offset;
        if (selection.from > start && selection.to < start + child.nodeSize) belongs = true;
      });
      if (belongs) return selection;
    }
    const end = location.itemPos + 2 + location.item.firstChild!.content.size;
    return TextSelection.create(state.doc, end);
  }
  return selection instanceof TextSelection && selection.$from.parent.isTextblock ? selection : null;
}

export function canPasteOutlinePlainText(editor: Editor, blockId?: string): boolean {
  return !pendingPastes.has(editor) && plainTextPasteSelection(editor, blockId) !== null;
}

/** Keyboard and menu commands share the same target and never fall back to structural paste. */
export async function pasteOutlinePlainTextFromClipboard(editor: Editor, blockId?: string): Promise<boolean> {
  if (pendingPastes.has(editor)) return false;
  const target = plainTextPasteSelection(editor, blockId);
  if (!target || !navigator.clipboard?.readText) return false;
  const view = activeOutlineView(editor);
  const { doc, selection } = editor.state;
  const outline = outlineViewState(editor.state);
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  const unchanged = () =>
    !editor.isDestroyed &&
    !view.isDestroyed &&
    editor.isEditable &&
    !view.composing &&
    activeOutlineView(editor) === view &&
    editor.state.doc === doc &&
    selection.eq(editor.state.selection) &&
    outlineViewState(editor.state) === outline;
  const changed = () => {
    if (!unchanged()) cancel();
  };
  // Remember intermediate moves too: returning to the same caret must not revive an old paste.
  editor.on('transaction', changed);
  editor.on('destroy', cancel);
  const cancellingEvents = ['blur', 'compositionstart', 'beforeinput', 'pointerdown'] as const;
  cancellingEvents.forEach((name) => view.dom.addEventListener(name, cancel, true));
  pendingPastes.add(editor);
  try {
    const text = await navigator.clipboard.readText();
    if (!text || text.length > 2_000_000 || cancelled || !unchanged() || !view.hasFocus()) return false;
    const content = target.$from.parent.type.spec.code
      ? Fragment.from(editor.schema.text(text.replace(/\r\n?/gu, '\n')))
      : plainTextInlineContent(editor.schema, text);
    if (!target.$from.parent.canReplace(target.$from.index(), target.$to.index(), content)) return false;
    const transaction = editor.state.tr.setSelection(target).replaceWith(target.from, target.to, content);
    transaction.setSelection(TextSelection.create(transaction.doc, target.from + content.size));
    transaction.setStoredMarks([]).setMeta('preventAutolink', true);
    attachOutlineView(transaction, { ...outline, selected: [], anchor: null, active: null }, outline);
    view.dispatch(transaction.scrollIntoView());
    return true;
  } catch {
    return false;
  } finally {
    pendingPastes.delete(editor);
    editor.off('transaction', changed);
    editor.off('destroy', cancel);
    cancellingEvents.forEach((name) => view.dom.removeEventListener(name, cancel, true));
  }
}
