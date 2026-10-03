import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import type { BlockNode } from '@/shared/contracts/block-document';
import { activeOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { revealInsertedReferences } from '@/renderer/features/content-editor/referenceToolbarState';
import {
  insertOutlineStructure,
  outlineItemRecords,
  type OutlineDropPlacement,
} from '@/renderer/features/content-editor/outlineMove';
import {
  attachOutlineView,
  outlinePlacementWithinFocus,
  outlineViewState,
} from '@/renderer/features/content-editor/outlineViewState';

const pendingDrops = new WeakSet<Editor>();
export const outlineDropPending = (editor: Editor) => pendingDrops.has(editor);

/** Resolve the whole drop before changing the outline, and keep the insertion in one undo step. */
export async function dropOutlineItems(
  editor: Editor,
  targetId: string,
  placement: OutlineDropPlacement,
  prepare: (assertCurrent: () => void) => Promise<BlockNode[]>,
) {
  if (outlineDropPending(editor)) throw new Error('REFERENCE_TARGET_CHANGED');
  const before = editor.state.doc;
  const focus = outlineViewState(editor.state).focus;
  const receivingView = activeOutlineView(editor);
  let cancelled = false;
  const disconnect = window.desktopApi?.onLocalSpaceTransition?.(() => {
    cancelled = true;
  });
  const assertCurrent = () => {
    if (
      cancelled ||
      editor.isDestroyed ||
      receivingView.isDestroyed ||
      !editor.isEditable ||
      receivingView.composing ||
      !editor.state.doc.eq(before) ||
      outlineViewState(editor.state).focus !== focus
    )
      throw new Error('REFERENCE_TARGET_CHANGED');
  };
  pendingDrops.add(editor);
  try {
    assertCurrent();
    const items = await prepare(assertCurrent);
    assertCurrent();
    if (!items.length) throw new Error('REFERENCE_LOCATION_MISSING');
    const view = outlineViewState(editor.state);
    if (!outlinePlacementWithinFocus(editor.state.doc, view, [], targetId, placement))
      throw new Error('REFERENCE_TARGET_CHANGED');
    const next = insertOutlineStructure(before.toJSON(), items, targetId, placement);
    if (!next || !outlineItemRecords(next).has(targetId)) throw new Error('REFERENCE_TARGET_CHANGED');
    const document = editor.schema.nodeFromJSON(next);
    document.check();
    const ids = items.map((item) => String(item.attrs!.blockId));
    const folded = new Set(view.folded);
    if (placement === 'INSIDE') folded.delete(targetId);
    // An insertion must not mark every existing paragraph/comment as deleted.
    const start = before.content.findDiffStart(document.content);
    const end = before.content.findDiffEnd(document.content);
    if (start === null || !end) throw new Error('REFERENCE_TARGET_CHANGED');
    const overlap = Math.max(0, start - Math.min(end.a, end.b));
    const transaction = closeHistory(editor.state.tr).replace(
      start,
      end.a + overlap,
      document.slice(start, end.b + overlap),
    );
    document.descendants((node, position) => {
      if (node.type.name === 'listItem' && node.attrs.blockId === ids[0])
        transaction.setSelection(TextSelection.create(transaction.doc, position + 2));
    });
    attachOutlineView(
      transaction,
      { ...view, folded, selected: ids, anchor: ids[0], active: ids.at(-1)!, drag: null, drop: null },
      view,
    );
    revealInsertedReferences(
      transaction,
      items.flatMap((item) =>
        (item.content ?? [])
          .filter((node) => node.type === 'contentReference')
          .map((node) => String(node.attrs?.blockId)),
      ),
    );
    if (editor.schema.marks.link) transaction.removeStoredMark(editor.schema.marks.link);
    receivingView.dispatch(transaction.setMeta('preventAutolink', true).scrollIntoView());
    receivingView.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  } finally {
    pendingDrops.delete(editor);
    disconnect?.();
  }
}
