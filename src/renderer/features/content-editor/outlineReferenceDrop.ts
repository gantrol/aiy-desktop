import type { Editor } from '@tiptap/core';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import {
  resolveReferenceDrop,
  type ReferenceDropContext,
} from '@/renderer/features/content-editor/resolveReferenceDrop';
import type { OutlineDropPlacement } from '@/renderer/features/content-editor/outlineMove';
import { dropOutlineItems } from '@/renderer/features/content-editor/outlineDrop';

/** Save the source, then insert the entire batch in one undo step; never remove it. */
export async function dropOutlineReferences(
  editor: Editor,
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>,
  targetId: string,
  placement: OutlineDropPlacement,
  context?: ReferenceDropContext,
) {
  return dropOutlineItems(editor, targetId, placement, async (assertCurrent) => {
    const references = await resolveReferenceDrop(payload, assertCurrent, context);
    return references.map((reference) => ({
      type: 'listItem',
      attrs: { blockId: crypto.randomUUID() },
      content: [{ type: 'paragraph', attrs: { blockId: crypto.randomUUID() } }, reference],
    }));
  });
}
