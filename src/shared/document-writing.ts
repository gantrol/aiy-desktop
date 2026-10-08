import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { contentMarkdownTree } from '@/shared/content-markdown';
import type { RootContent } from 'mdast';

/** Text candidates cannot introduce media, raw HTML or live AIY references. */
export function documentWritingCandidate(markdown: string) {
  if (!markdown.trim() || markdown.length > 10_000) throw new Error('DOCUMENT_WRITING_INVALID_RESULT');
  const stack: Array<RootContent | { type: string; children?: unknown[] }> = [
    ...contentMarkdownTree(markdown).children,
  ];
  while (stack.length) {
    const node = stack.pop()!;
    if (['image', 'imageReference', 'html'].includes(node.type)) throw new Error('DOCUMENT_WRITING_INVALID_RESULT');
    if ('children' in node && node.children) stack.push(...(node.children as RootContent[]));
  }
  const document = markdownBlockDocument(markdown);
  const blocks = [document.root];
  while (blocks.length) {
    const node = blocks.pop()!;
    if (['contentReference', 'image', 'creatorTerm', 'creatorRecipe'].includes(node.type ?? ''))
      throw new Error('DOCUMENT_WRITING_INVALID_RESULT');
    blocks.push(...(node.content ?? []));
  }
  return document;
}
