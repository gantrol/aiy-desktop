import { captureBlockDocument, type BlockNode } from '@/shared/contracts/block-document';

/** The editor's Duplicate block command keeps local links within its new subtree. */
export function copyLinkedBlockDocument(root: BlockNode) {
  const copied = captureBlockDocument(root, [], true);
  return { ...copied, root: rebindCopiedBlockAnchors(root, copied.root) };
}

/** Rebind only unambiguous links whose targets are inside the copied subtree. */
export function rebindCopiedBlockAnchors(original: BlockNode, copied: BlockNode): BlockNode {
  const mapping = new Map<string, string>();
  const ambiguous = new Set<string>();
  const collect = (before: BlockNode, after: BlockNode) => {
    const oldId = before.attrs?.blockId || before.attrs?.articleElementId;
    const newId = after.attrs?.blockId;
    if (typeof oldId === 'string' && oldId && typeof newId === 'string' && newId) {
      if (mapping.has(oldId)) ambiguous.add(oldId);
      else mapping.set(oldId, newId);
    }
    before.content?.forEach((child, index) => {
      const counterpart = after.content?.[index];
      if (counterpart) collect(child, counterpart);
    });
  };
  collect(original, copied);
  const visit = (node: BlockNode): BlockNode => ({
    ...node,
    ...(node.marks
      ? {
          marks: node.marks.map((mark) => {
            const href = mark.attrs?.href;
            if (mark.type !== 'link' || typeof href !== 'string' || !href.startsWith('#aiy-block:')) return mark;
            let id: string;
            try {
              id = decodeURIComponent(href.slice('#aiy-block:'.length));
            } catch {
              return mark;
            }
            const target = mapping.get(id);
            if (!target || ambiguous.has(id)) return mark;
            return { ...mark, attrs: { ...mark.attrs, href: `#aiy-block:${encodeURIComponent(target)}` } };
          }),
        }
      : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return visit(copied);
}
