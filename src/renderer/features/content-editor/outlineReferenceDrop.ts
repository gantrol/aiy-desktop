import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import type { BlockNode } from '@/shared/contracts/block-document';
import { followingPresentation } from '@/shared/content-reference-token';
import type { ReferenceTarget } from '@/shared/contracts/content-source';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
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

/** Save the source, then insert the entire batch in one undo step; never remove it. */
export async function dropOutlineReferences(
  editor: Editor,
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>,
  targetId: string,
  placement: OutlineDropPlacement,
) {
  const before = editor.state.doc;
  const focus = outlineViewState(editor.state).focus;
  let cancelled = false;
  const disconnect = window.desktopApi?.onLocalSpaceTransition?.(() => {
    cancelled = true;
  });
  const assertCurrent = () => {
    if (
      cancelled ||
      editor.isDestroyed ||
      !editor.isEditable ||
      editor.view.composing ||
      !editor.state.doc.eq(before) ||
      outlineViewState(editor.state).focus !== focus
    )
      throw new Error('REFERENCE_TARGET_CHANGED');
  };
  try {
    assertCurrent();
    const source = payload.prepare ? await payload.prepare() : undefined;
    if (payload.prepare && !source) throw new Error('REFERENCE_SAVE_FAILED');
    const api = contentLibraryApi();
    const items: BlockNode[] = [];
    for (const target of payload.targets) {
      assertCurrent();
      if (source && (source.kind !== target.source.kind || source.id !== target.source.id))
        throw new Error('REFERENCE_TARGET_CHANGED');
      let requested: ReferenceTarget = source ? { ...target, source } : target;
      if (payload.mode === 'FOLLOW') {
        if (requested.source.kind !== 'ARTICLE' || requested.source.branchId || requested.source.noteId)
          throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
        requested = { ...requested, source: { kind: 'ARTICLE', id: requested.source.id } };
      }
      const preview = await api.referenceInspect(requested);
      assertCurrent();
      const reference =
        payload.mode === 'FOLLOW'
          ? await api.referenceFollow(preview.target, preview.version)
          : await api.referenceCapture(preview.target, preview.version, preview.resolutionId);
      assertCurrent();
      if (preview.spaceId !== reference.spaceId) throw new Error('REFERENCE_TARGET_CHANGED');
      items.push({
        type: 'listItem',
        attrs: { blockId: crypto.randomUUID() },
        content: [
          { type: 'paragraph', attrs: { blockId: crypto.randomUUID() } },
          {
            type: 'contentReference',
            attrs: {
              blockId: crypto.randomUUID(),
              referenceId: reference.id,
              referenceSpaceId: reference.spaceId ?? null,
              referencePresentation: payload.mode === 'FOLLOW' ? followingPresentation : null,
              referenceEditing: 'READ_ONLY',
            },
          },
        ],
      });
    }
    assertCurrent();
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
    const transaction = closeHistory(editor.state.tr).replaceWith(0, before.content.size, document.content);
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
    editor.view.dispatch(transaction.scrollIntoView());
  } finally {
    disconnect?.();
  }
}
