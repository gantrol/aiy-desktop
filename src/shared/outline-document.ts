import { captureBlockDocument, type BlockDocument, type BlockNode } from '@/shared/contracts/block-document';

/** A new outline uses the shared document schema; notes and media stay inside their item. */
export function createOutlineDocument(document: BlockDocument): BlockDocument {
  const items: BlockNode[] = [];
  for (const block of structuredClone(document.root.content ?? [])) {
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      items.push(...(block.content ?? []));
    } else if (block.type === 'paragraph' || block.type === 'heading') {
      items.push({ type: 'listItem', content: [{ ...block, type: 'paragraph' }] });
    } else {
      if (!items.length) items.push({ type: 'listItem', content: [{ type: 'paragraph' }] });
      items[items.length - 1]!.content!.push(block);
    }
  }
  if (!items.length) items.push({ type: 'listItem', content: [{ type: 'paragraph' }] });
  return captureBlockDocument({ type: 'doc', content: [{ type: 'bulletList', content: items }] });
}
