import type { Editor } from '@tiptap/core';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import { resolveDroppedContentLinks } from '@/renderer/features/content-editor/contentLinkDrop';
import { dropOutlineItems } from '@/renderer/features/content-editor/outlineDrop';
import type { OutlineDropPlacement } from '@/renderer/features/content-editor/outlineMove';

/** Sidebar objects become navigation links; they do not move or capture the source content. */
export function dropOutlineContentLinks(
  editor: Editor,
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>,
  spaceId: string,
  targetId: string,
  placement: OutlineDropPlacement,
) {
  return dropOutlineItems(editor, targetId, placement, async (assertCurrent) => {
    const links = await resolveDroppedContentLinks(payload, spaceId, assertCurrent);
    return links.map((link) => ({
      type: 'listItem',
      attrs: { blockId: crypto.randomUUID() },
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: crypto.randomUUID() },
          content: [
            { type: 'text', text: link.title || link.url, marks: [{ type: 'link', attrs: { href: link.url } }] },
          ],
        },
      ],
    }));
  });
}
