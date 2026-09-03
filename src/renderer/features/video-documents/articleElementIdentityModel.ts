import type { ArticleElementNodeType, ArticleElementPlacementInput } from '@/shared/contracts';

export const ARTICLE_ELEMENT_ATTRIBUTE = 'articleElementId';

export const articleElementNodeTypes: readonly ArticleElementNodeType[] = [
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'image',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
];

const articleElementNodeTypeSet = new Set<string>(articleElementNodeTypes);

export function isArticleElementNodeType(value: string): value is ArticleElementNodeType {
  return articleElementNodeTypeSet.has(value);
}

export function nextArticleElementId() {
  return globalThis.crypto.randomUUID();
}

export function takeSavedArticleElement(
  saved: readonly ArticleElementPlacementInput[],
  unused: Map<string, ArticleElementPlacementInput>,
  candidate: Pick<ArticleElementPlacementInput, 'blockIndex' | 'nodeType' | 'textFingerprint'>,
) {
  const exact = saved.find(
    (placement) =>
      placement.blockIndex === candidate.blockIndex &&
      placement.nodeType === candidate.nodeType &&
      placement.textFingerprint === candidate.textFingerprint &&
      unused.has(placement.elementId),
  );
  const matching =
    exact ??
    saved.find(
      (placement) =>
        placement.nodeType === candidate.nodeType &&
        placement.textFingerprint === candidate.textFingerprint &&
        unused.has(placement.elementId),
    );
  if (matching) unused.delete(matching.elementId);
  return matching;
}
