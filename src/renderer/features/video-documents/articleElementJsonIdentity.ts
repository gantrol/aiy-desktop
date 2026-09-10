import type { JSONContent } from '@tiptap/core';
import type { ArticleElementNodeType, ArticleElementPlacementInput } from '@/shared/contracts';
import { articleElementTextFingerprint } from '@/shared/contracts/article';
import {
  ARTICLE_ELEMENT_ATTRIBUTE,
  articleElementImageText,
  isArticleElementNodeType,
  nextArticleElementId,
  takeSavedArticleElement,
} from '@/renderer/features/video-documents/articleElementIdentityModel';

function jsonContentText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(jsonContentText).join('');
}

function jsonElementText(node: JSONContent, nodeType: ArticleElementNodeType) {
  if (nodeType !== 'image') return jsonContentText(node);
  return articleElementImageText(node.attrs);
}

export function hydrateArticleElementJsonIdentities(
  content: JSONContent,
  saved: readonly ArticleElementPlacementInput[],
) {
  const unused = new Map(saved.map((placement) => [placement.elementId, placement]));
  let blockIndex = 0;

  const visit = (node: JSONContent, parentType: string | null) => {
    if (node.type && isArticleElementNodeType(node.type) && (node.type !== 'paragraph' || parentType === 'doc')) {
      const matching = takeSavedArticleElement(saved, unused, {
        blockIndex,
        nodeType: node.type,
        textFingerprint: articleElementTextFingerprint(node.type, jsonElementText(node, node.type)),
      });
      node.attrs = { ...node.attrs, [ARTICLE_ELEMENT_ATTRIBUTE]: matching?.elementId ?? nextArticleElementId() };
      blockIndex += 1;
    }
    for (const child of node.content ?? []) visit(child, node.type ?? null);
  };

  visit(content, null);
}
