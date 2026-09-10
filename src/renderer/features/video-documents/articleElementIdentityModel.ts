import type { ArticleElementNodeType, ArticleElementPlacementInput } from '@/shared/contracts';

export const ARTICLE_ELEMENT_ATTRIBUTE = 'blockId';

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

export function articleElementImageText(attrs: Record<string, unknown> | undefined) {
  return [attrs?.alt, attrs?.title, attrs?.mediaPath || attrs?.sourcePath || attrs?.src || attrs?.assetId]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' ');
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

/** Older image fingerprints included the resolved asset URL. Recover the same local placement when that URL changes. */
export function takeSavedArticleImageElement(
  saved: readonly ArticleElementPlacementInput[],
  unused: Map<string, ArticleElementPlacementInput>,
  blockIndex: number,
  sourcePath: unknown,
) {
  if (typeof sourcePath !== 'string' || !sourcePath.startsWith('assets/')) return undefined;
  const candidates = saved.filter(
    (placement) =>
      placement.nodeType === 'image' &&
      unused.has(placement.elementId) &&
      placement.preview.split(/\s+/u).includes(sourcePath),
  );
  const matching =
    candidates.find((placement) => placement.blockIndex === blockIndex) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (matching) unused.delete(matching.elementId);
  return matching;
}
