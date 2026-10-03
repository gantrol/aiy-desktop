import type { Editor } from '@tiptap/core';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import type { BlockNode } from '@/shared/contracts/block-document';
import { followingPresentation } from '@/shared/content-reference-token';
import type { ReferenceTarget } from '@/shared/contracts/content-source';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import type { OutlineDropPlacement } from '@/renderer/features/content-editor/outlineMove';
import { dropOutlineItems } from '@/renderer/features/content-editor/outlineDrop';

/** Save the source, then insert the entire batch in one undo step; never remove it. */
export async function dropOutlineReferences(
  editor: Editor,
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>,
  targetId: string,
  placement: OutlineDropPlacement,
) {
  return dropOutlineItems(editor, targetId, placement, async (assertCurrent) => {
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
    return items;
  });
}
