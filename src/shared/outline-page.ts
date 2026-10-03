import { copyLinkedBlockDocument } from '@/shared/block-anchor-copy';
import { blockNodeText } from '@/shared/content-outline';
import { outlineItemRecords, outlineSelectionRoots } from '@/shared/outline-move';
import { isOutlineChildList } from '@/shared/outline-structure';
import type { BlockNode } from '@/shared/contracts/block-document';
import { contentLinkUrl } from '@/shared/contracts/content-links';

function retainSourceAnchors(root: BlockNode, source: { spaceId: string; articleId: string }) {
  const included = new Set<string>();
  const collect = (node: BlockNode) => {
    if (typeof node.attrs?.blockId === 'string') included.add(node.attrs.blockId);
    node.content?.forEach(collect);
  };
  collect(root);
  const visit = (node: BlockNode): BlockNode => ({
    ...node,
    ...(node.marks
      ? {
          marks: node.marks.map((mark) => {
            const href = mark.attrs?.href;
            if (mark.type !== 'link' || typeof href !== 'string' || !href.startsWith('#aiy-block:')) return mark;
            let blockId: string;
            try {
              blockId = decodeURIComponent(href.slice('#aiy-block:'.length));
            } catch {
              return mark;
            }
            if (included.has(blockId)) return mark;
            return {
              ...mark,
              attrs: {
                ...mark.attrs,
                href: contentLinkUrl({
                  spaceId: source.spaceId,
                  target: { kind: 'ARTICLE', id: source.articleId, blockId },
                }),
              },
            };
          }),
        }
      : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return visit(root);
}

/** Selected parents include their whole branch, including folded descendants and notes. */
export function outlinePageContent(
  root: BlockNode,
  selectedIds: readonly string[],
  untitledTitle: string,
  source: { spaceId: string; articleId: string },
) {
  const roots = outlineSelectionRoots(root, selectedIds);
  if (!roots.length) throw new Error('REFERENCE_LOCATION_MISSING');
  const records = outlineItemRecords(root);
  const items = roots.map((id) => records.get(id)!.node);
  const heading = items[0].content?.[0];
  const headingText = blockNodeText(heading ?? {}).trim();
  const title = headingText.slice(0, 200) || untitledTitle;
  const children = items[0].content?.slice(1) ?? [];
  // A plain branch heading becomes the page title. Keep an item wrapper when it owns
  // notes or task metadata, so those retain their original outline semantics.
  const promote =
    items.length === 1 &&
    children.length > 0 &&
    children.every(isOutlineChildList) &&
    !items[0].attrs?.taskState &&
    headingText.length <= 200 &&
    heading?.content?.every((node) => node.type === 'text' && !node.marks?.length);
  const body: BlockNode = {
    type: 'doc',
    content: promote ? children : [{ type: 'bulletList', content: items }],
  };
  // Local anchors outside the new page still belong to the original article.
  const document = copyLinkedBlockDocument(retainSourceAnchors(body, source));
  return { roots, title, document };
}

/** Leave a navigation link at each former branch location without moving unselected siblings. */
export function linkOutlinePage(root: BlockNode, roots: readonly string[], href: string, title: string): BlockNode {
  const selected = new Set(roots);
  const visit = (node: BlockNode): BlockNode => {
    if (node.type === 'listItem' && selected.has(String(node.attrs?.blockId))) {
      const heading = node.content?.[0];
      return {
        ...node,
        content: [
          {
            type: 'paragraph',
            attrs: heading?.attrs,
            content: [
              {
                type: 'text',
                text: blockNodeText(heading ?? {}).trim() || title,
                marks: [{ type: 'link', attrs: { href } }],
              },
            ],
          },
        ],
      };
    }
    return { ...node, ...(node.content ? { content: node.content.map(visit) } : {}) };
  };
  return visit(root);
}
