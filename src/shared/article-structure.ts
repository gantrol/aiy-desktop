import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import type { ArticleStructureNode } from '@/shared/contracts/article-structure';

const kinds: Record<string, ArticleStructureNode['kind']> = {
  heading: 'heading',
  listItem: 'item',
  taskItem: 'item',
  paragraph: 'paragraph',
  image: 'image',
  contentReference: 'reference',
  linkCard: 'link',
  table: 'table',
  codeBlock: 'code',
  blockquote: 'quote',
  details: 'group',
  reveal: 'group',
};

/** Short labels use only this block's text; a list item never absorbs all descendant prose. */
function label(node: BlockNode) {
  const pending = [...(node.content ?? [])].reverse();
  let text = node.text ?? '';
  while (pending.length && text.length < 180) {
    const child = pending.pop()!;
    if (child.type === 'text') text += child.text ?? '';
    else if (child.type === 'hardBreak') text += ' ';
    else if (!['bulletList', 'orderedList', 'taskList', 'table'].includes(child.type ?? ''))
      pending.push(...(child.content ?? []).slice().reverse());
  }
  return text.replace(/\s+/gu, ' ').trim().slice(0, 180);
}

function blockDetails(node: BlockNode, kind: ArticleStructureNode['kind'], assets: ReadonlyMap<string, string>) {
  const path = node.attrs?.mediaPath ?? node.attrs?.sourcePath ?? node.attrs?.src;
  const assetId = node.attrs?.assetId ?? assets.get(String(path ?? ''));
  const title =
    kind === 'image'
      ? String(node.attrs?.alt || node.attrs?.title || '')
      : kind === 'link'
        ? String(node.attrs?.title || node.attrs?.url || '')
        : kind === 'item'
          ? label(node.content?.[0] ?? node)
          : label(node);
  return {
    title: title.slice(0, 180),
    ...(kind === 'image' && typeof assetId === 'string' && assetId ? { assetId } : {}),
    ...(kind === 'reference' && typeof node.attrs?.referenceId === 'string'
      ? { referenceId: node.attrs.referenceId }
      : {}),
  };
}

/** A read projection of existing identities, shared by saved content and the live editing session. */
export function projectArticleStructure(
  document: BlockDocument | undefined,
  bindings: readonly { path: string; assetId: string }[] = [],
): ArticleStructureNode[] {
  if (!document) return [];
  const result: ArticleStructureNode[] = [];
  const assets = new Map(bindings.map((binding) => [binding.path, binding.assetId]));
  const visit = (children: readonly BlockNode[], parent: string | null, omitFirstParagraph = false) => {
    const headings: { id: string; level: number }[] = [];
    for (const [index, node] of children.entries()) {
      const id = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : null;
      const kind = kinds[node.type ?? ''];
      const headingLevel = node.type === 'heading' ? Number(node.attrs?.level ?? 1) : null;
      if (headingLevel !== null)
        while (headings.length && headings[headings.length - 1].level >= headingLevel) headings.pop();
      const owner = headings[headings.length - 1]?.id ?? parent;
      const included = id && kind && !(omitFirstParagraph && index === 0 && node.type === 'paragraph');
      if (included) {
        result.push({
          blockId: id,
          parentBlockId: owner,
          kind,
          ...blockDetails(node, kind, assets),
        });
        if (headingLevel !== null) headings.push({ id, level: headingLevel });
      }
      if (node.content && !['table', 'codeBlock', 'heading', 'paragraph'].includes(node.type ?? ''))
        visit(node.content, included ? id : owner, kind === 'item');
    }
  };
  visit(document.root.content ?? [], null);
  // Ambiguous imported identities cannot authorize navigation to an arbitrary occurrence.
  const counts = new Map<string, number>();
  for (const node of result) counts.set(node.blockId, (counts.get(node.blockId) ?? 0) + 1);
  return result
    .filter((node) => counts.get(node.blockId) === 1)
    .map((node) => ({
      ...node,
      parentBlockId: node.parentBlockId && counts.get(node.parentBlockId) === 1 ? node.parentBlockId : null,
    }));
}
