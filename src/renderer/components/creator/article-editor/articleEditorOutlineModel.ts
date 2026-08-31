import type { VideoDocumentArticleHeading } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';

export type ArticleEditorOutlineDepthLimit = 1 | 2 | 6;

export interface ArticleEditorOutlineNode {
  item: VideoDocumentArticleHeading;
  sourceIndex: number;
  depth: number;
  parentId: string | null;
  ancestorIds: readonly string[];
  hasChildren: boolean;
}

export interface VisibleArticleEditorOutlineNode extends ArticleEditorOutlineNode {
  hasVisibleChildren: boolean;
}

interface VisibilityOptions {
  collapsedIds: ReadonlySet<string>;
  depthLimit: ArticleEditorOutlineDepthLimit;
  query: string;
}

export function buildArticleEditorOutlineNodes(
  items: readonly VideoDocumentArticleHeading[],
): ArticleEditorOutlineNode[] {
  const nodes: ArticleEditorOutlineNode[] = [];
  const stack: ArticleEditorOutlineNode[] = [];
  items.forEach((item, sourceIndex) => {
    while (stack.length > 0 && stack[stack.length - 1]!.item.level >= item.level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    const node: ArticleEditorOutlineNode = {
      item,
      sourceIndex,
      depth: parent ? parent.depth + 1 : 0,
      parentId: parent?.item.id ?? null,
      ancestorIds: parent ? [...parent.ancestorIds, parent.item.id] : [],
      hasChildren: false,
    };
    if (parent) parent.hasChildren = true;
    nodes.push(node);
    stack.push(node);
  });
  return nodes;
}

export function visibleArticleEditorOutlineNodes(
  nodes: readonly ArticleEditorOutlineNode[],
  { collapsedIds, depthLimit, query }: VisibilityOptions,
): VisibleArticleEditorOutlineNode[] {
  const eligibleNodes = nodes.filter((node) => node.depth < depthLimit);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const includedIds = new Set<string>();

  if (normalizedQuery) {
    eligibleNodes.forEach((node) => {
      if (!node.item.title.toLocaleLowerCase().includes(normalizedQuery)) return;
      includedIds.add(node.item.id);
      node.ancestorIds.forEach((id) => includedIds.add(id));
    });
  } else {
    eligibleNodes.forEach((node) => includedIds.add(node.item.id));
  }

  const candidates = eligibleNodes.filter((node) => includedIds.has(node.item.id));
  const expandableIds = new Set(
    candidates.flatMap((node) => (node.parentId && includedIds.has(node.parentId) ? [node.parentId] : [])),
  );

  return candidates
    .filter((node) => normalizedQuery || !node.ancestorIds.some((ancestorId) => collapsedIds.has(ancestorId)))
    .map((node) => ({ ...node, hasVisibleChildren: expandableIds.has(node.item.id) }));
}
