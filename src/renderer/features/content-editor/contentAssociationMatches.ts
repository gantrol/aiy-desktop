import type { BlockNode } from '@/shared/contracts/block-document';
import { blockNodeText } from '@/shared/content-outline';
import { contentSearchTerms, contentSearchHighlights } from '@/shared/content-search-highlights';
import { normalizeSearchText } from '@/shared/content-search-query';

export interface AssociationBlockMatch {
  blockId: string;
  text: string;
  path: string;
}

/** Search the one explicitly selected document, preserving real block identities and parent context. */
export function contentAssociationMatches(root: BlockNode, query: string): AssociationBlockMatch[] {
  const terms = contentSearchTerms(query);
  if (!terms.length) return [];
  const matches: AssociationBlockMatch[] = [];
  const counts = new Map<string, number>();
  const count = (node: BlockNode) => {
    if (typeof node.attrs?.blockId === 'string')
      counts.set(node.attrs.blockId, (counts.get(node.attrs.blockId) ?? 0) + 1);
    node.content?.forEach(count);
  };
  count(root);
  const visit = (node: BlockNode, path: string[], itemId?: string) => {
    const isItem = node.type === 'listItem' || node.type === 'taskItem';
    const id = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : undefined;
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '')) {
      const text = blockNodeText(node);
      const normalized = normalizeSearchText(text);
      const blockId = itemId ?? id;
      if (blockId && counts.get(blockId) === 1 && terms.every((term) => normalized.includes(term))) {
        const position = contentSearchHighlights(text, terms)[0]?.start ?? 0;
        const start = Math.max(0, position - 60);
        matches.push({ blockId, text: `${start ? '…' : ''}${text.slice(start, start + 240)}`, path: path.join(' › ') });
      }
      return;
    }
    if (node.type === 'contentReference') return;
    const title = isItem ? blockNodeText(node.content?.[0] ?? node).slice(0, 80) : '';
    node.content?.forEach((child, index) =>
      visit(child, isItem && index > 0 && title ? [...path, title] : path, isItem && index === 0 ? id : undefined),
    );
  };
  visit(root, []);
  return matches;
}
