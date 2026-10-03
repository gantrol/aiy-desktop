import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { outlineItemRecords, type OutlineDropPlacement } from '@/renderer/features/content-editor/outlineMove';
import { outlineViewState } from '@/renderer/features/content-editor/outlineViewState';

const titleSelector = ':scope > [data-node-view-content] > [data-node-view-content-react] > p:first-child';

/** Hover and release use the same geometry, including the top edge of every sibling. */
export function outlineRowDropPlacement(
  element: HTMLElement,
  pointer: { clientX: number; clientY: number },
  focused: boolean,
): OutlineDropPlacement {
  if (focused) return 'INSIDE';
  const title = element.querySelector<HTMLElement>(titleSelector);
  const rect = (title ?? element).getBoundingClientRect();
  const edge = Math.min(8, rect.height * 0.25);
  if (pointer.clientY <= rect.top + edge) return 'BEFORE';
  if (pointer.clientY >= rect.bottom - edge) return 'AFTER';
  if (pointer.clientX >= rect.left + 24) return 'INSIDE';
  return pointer.clientY < rect.top + rect.height / 2 ? 'BEFORE' : 'AFTER';
}

/** Blank space belongs to the adjacent sibling in the current scope, not always the document end. */
export function outlineEdgeDrop(editor: Editor, view: EditorView, pointerY: number) {
  const focus = outlineViewState(editor.state).focus;
  const siblings = new Set(
    [...outlineItemRecords(editor.state.doc.toJSON())]
      .filter(([, item]) => (item.ancestors.at(-1) ?? null) === focus)
      .map(([id]) => id),
  );
  let last: string | null = null;
  for (const element of view.dom.querySelectorAll<HTMLElement>('.aiy-outline-item[data-outline-id]')) {
    const id = element.dataset.outlineId!;
    if (!siblings.has(id) || element.closest('.ProseMirror') !== view.dom) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.height) continue;
    const title = element.querySelector<HTMLElement>(titleSelector)?.getBoundingClientRect() ?? rect;
    if (pointerY <= title.top + title.height / 2) return { id, placement: 'BEFORE' as const };
    if (pointerY <= rect.bottom) return { id, placement: 'AFTER' as const };
    last = id;
  }
  return last ? { id: last, placement: 'AFTER' as const } : focus ? { id: focus, placement: 'INSIDE' as const } : null;
}
