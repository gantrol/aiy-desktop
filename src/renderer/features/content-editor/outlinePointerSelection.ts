import { Extension, type Editor } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { forgetOutlineView, rememberOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import {
  outlineViewState,
  outlineVisibleItems,
  selectOutlineItem,
  setOutlineView,
} from '@/renderer/features/content-editor/outlineViewState';

const titleSelector = ':scope > [data-node-view-content] > [data-node-view-content-react] > p:first-child';
const interactiveSelector =
  'a, button, input, textarea, select, [role="button"], [contenteditable="false"], [data-outline-control]';

/** Notes and embedded controls keep their own text and pointer behavior. */
export function outlineTextSelectionItem(target: EventTarget | null, canvas: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element) || target.closest(interactiveSelector)) return null;
  const item = target.closest<HTMLElement>('.aiy-outline-item[data-outline-id]');
  if (!item || !canvas.contains(item) || item.dataset.outlineVisibility !== 'inside') return null;
  const title = item.querySelector<HTMLElement>(titleSelector);
  return title?.contains(target) ? item : null;
}

export function editingItemId(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.attrs.outlineRole === 'NOTE' || node.type.name === 'taskList') return null;
  }
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'listItem') return String(node.attrs.blockId ?? '') || null;
  }
  return null;
}

function focusSelectedItem(editor: Editor, id: string, view: EditorView) {
  let position: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'listItem' && node.attrs.blockId === id) {
      position = pos;
      return false;
    }
  });
  if (position !== null)
    view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.near(editor.state.doc.resolve(position + 2)))
        .setMeta('addToHistory', false),
    );
  rememberOutlineView(editor, view);
  view.focus();
}

/** A drag becomes item selection only after crossing into another visible title. */
export const OutlinePointerSelection = Extension.create({
  name: 'outlinePointerSelection',
  addProseMirrorPlugins() {
    const editor = this.editor;
    let stopDrag: (() => void) | null = null;
    let suppressClick = false;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    return [
      new Plugin({
        view: (view) => {
          const activate = () => rememberOutlineView(editor, view);
          // Capture also sees buttons inside node views, before their stopEvent handler.
          view.dom.addEventListener('mousedown', activate, true);
          view.dom.addEventListener('focusin', activate);
          return {
            destroy: () => {
              view.dom.removeEventListener('mousedown', activate, true);
              view.dom.removeEventListener('focusin', activate);
              forgetOutlineView(editor, view);
              stopDrag?.();
              if (clickTimer !== null) clearTimeout(clickTimer);
            },
          };
        },
        props: {
          handleDOMEvents: {
            click: (_view, event) => {
              if (!suppressClick) return false;
              event.preventDefault();
              return true;
            },
            mousedown: (view, event) => {
              stopDrag?.();
              if (!editor.isEditable || editor.isDestroyed || view.composing || event.button !== 0 || event.altKey)
                return false;
              const item = outlineTextSelectionItem(event.target, view.dom);
              const startId = item?.dataset.outlineId;
              if (!startId) return false;
              if (event.shiftKey || event.ctrlKey || event.metaKey) {
                if (event.shiftKey && !outlineViewState(editor.state).anchor) {
                  const anchor = editingItemId(editor);
                  if (anchor) setOutlineView(editor, { ...outlineViewState(editor.state), anchor });
                }
                event.preventDefault();
                selectOutlineItem(editor, startId, event.shiftKey, event.ctrlKey || event.metaKey);
                view.focus();
                return true;
              }

              const startX = event.clientX;
              const startY = event.clientY;
              const startingDoc = editor.state.doc;
              const startingFocus = outlineViewState(editor.state).focus;
              let active = false;
              let lastId = startId;
              const owner = view.dom.ownerDocument;
              const stop = () => {
                owner.removeEventListener('mousemove', move, true);
                owner.removeEventListener('mouseup', end, true);
                owner.defaultView?.removeEventListener('blur', stop);
                view.dom.classList.remove('aiy-outline-range-selecting');
                stopDrag = null;
              };
              const move = (next: MouseEvent) => {
                if (
                  editor.isDestroyed ||
                  !editor.isEditable ||
                  view.composing ||
                  editor.state.doc !== startingDoc ||
                  outlineViewState(editor.state).focus !== startingFocus ||
                  !(next.buttons & 1)
                ) {
                  stop();
                  return;
                }
                if (!active && Math.hypot(next.clientX - startX, next.clientY - startY) < 7) return;
                const target = owner.elementFromPoint?.(next.clientX, next.clientY) ?? next.target;
                const nextId = outlineTextSelectionItem(target, view.dom)?.dataset.outlineId;
                if (!nextId || (!active && nextId === startId)) return;
                const current = outlineViewState(editor.state);
                const visible = outlineVisibleItems(editor.state.doc, current).map((row) => row.id);
                const from = visible.indexOf(startId);
                const to = visible.indexOf(nextId);
                if (from < 0 || to < 0) return;
                next.preventDefault();
                if (!active) {
                  active = true;
                  view.dom.classList.add('aiy-outline-range-selecting');
                  focusSelectedItem(editor, startId, view);
                }
                owner.getSelection()?.removeAllRanges();
                if (lastId === nextId && current.selected.length) return;
                lastId = nextId;
                setOutlineView(editor, {
                  ...current,
                  selected: visible.slice(Math.min(from, to), Math.max(from, to) + 1),
                  anchor: startId,
                  active: nextId,
                });
              };
              const end = (next: MouseEvent) => {
                stop();
                if (!active || editor.isDestroyed) return;
                next.preventDefault();
                focusSelectedItem(editor, lastId, view);
                suppressClick = true;
                if (clickTimer !== null) clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                  suppressClick = false;
                  clickTimer = null;
                }, 0);
              };
              stopDrag = stop;
              owner.addEventListener('mousemove', move, true);
              owner.addEventListener('mouseup', end, true);
              owner.defaultView?.addEventListener('blur', stop);
              return false;
            },
          },
        },
      }),
    ];
  },
});
