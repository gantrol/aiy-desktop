import type { JSONContent } from '@tiptap/core';
import { htmlFileAttributesSchema } from '@/shared/contracts/html-file';
import { contentMarkdownTree } from '@/shared/content-markdown';
import type { RootContent, PhrasingContent } from 'mdast';

export const htmlFileLink = (hash: string, spaceId: string) => `aiy-html:${encodeURIComponent(spaceId)}/${hash}`;
export function parseHtmlFileLink(url: string, fileName: string) {
  const match = /^aiy-html:([^/]+)\/([a-f0-9]{64})$/u.exec(url);
  if (!match) return null;
  try {
    const result = htmlFileAttributesSchema.safeParse({
      objectHash: match[2],
      spaceId: decodeURIComponent(match[1]),
      fileName,
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function htmlFilesInMarkdown(markdown: string) {
  const found = new Map<string, { objectHash: string; fileName: string; spaceId: string }>();
  const walk = (node: RootContent | PhrasingContent) => {
    if (node.type === 'link') {
      const fileName = node.children.map((child) => ('value' in child ? child.value : '')).join('') || 'page.html';
      const file = parseHtmlFileLink(node.url, fileName);
      if (file) found.set(node.url, file);
    }
    if ('children' in node) node.children.forEach((child) => walk(child as RootContent));
  };
  contentMarkdownTree(markdown).children.forEach(walk);
  return [...found.values()];
}
export function htmlFileMarkdown(node: JSONContent) {
  const parsed = htmlFileAttributesSchema.safeParse(node.attrs);
  if (!parsed.success) return '';
  const label = parsed.data.fileName.replace(/[\\\[\]]/gu, '\\$&');
  return `[${label}](${htmlFileLink(parsed.data.objectHash, parsed.data.spaceId)})`;
}
