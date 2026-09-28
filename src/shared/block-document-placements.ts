import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import { contentElementNodeTypeSchema, type ContentElementPlacementInput } from '@/shared/contracts/content-comments';
import { articleElementTextFingerprint } from '@/shared/contracts/article';

/** Persist the same preorder element index that the editor publishes, without mounting an editor. */
export function blockDocumentPlacements(document: BlockDocument): ContentElementPlacementInput[] {
  const placements: ContentElementPlacementInput[] = [];
  const plainText = (node: BlockNode): string => node.text ?? (node.content ?? []).map(plainText).join('');
  const visit = (node: BlockNode, parent: BlockNode | null) => {
    const type = contentElementNodeTypeSchema.safeParse(node.type);
    const elementId = node.attrs?.blockId;
    if (type.success && typeof elementId === 'string' && (node.type !== 'paragraph' || parent?.type === 'doc')) {
      const text =
        node.type === 'image'
          ? [
              node.attrs?.alt,
              node.attrs?.title,
              node.attrs?.mediaPath || node.attrs?.sourcePath || node.attrs?.src || node.attrs?.assetId,
            ]
              .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
              .join(' ')
          : plainText(node);
      placements.push({
        elementId,
        blockIndex: placements.length,
        nodeType: type.data,
        textFingerprint: articleElementTextFingerprint(type.data, text),
        preview: text.replace(/\s+/gu, ' ').trim().slice(0, 280),
      });
    }
    node.content?.forEach((child) => visit(child, node));
  };
  visit(document.root, null);
  return placements;
}
