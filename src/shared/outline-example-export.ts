import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';

/** Markdown has no portable stable block IDs. Keep link labels instead of exporting dead URLs. */
export function outlineExampleMarkdown(document: BlockDocument): string {
  const visit = (node: BlockNode): BlockNode => ({
    ...node,
    ...(node.marks
      ? {
          marks: node.marks.filter(
            (mark) => mark.type !== 'link' || !String(mark.attrs?.href ?? '').startsWith('#aiy-block:'),
          ),
        }
      : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return blockDocumentMarkdown({ ...document, root: visit(document.root) });
}
