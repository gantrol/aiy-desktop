import type { PhrasingContent } from 'mdast';
import { contentMarkdownTree } from '@/shared/content-markdown';

function inlineText(node: PhrasingContent): string | null {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'break') return '\n';
  if ('children' in node) {
    const parts = node.children.map(inlineText);
    return parts.includes(null) ? null : parts.join('');
  }
  // Images, raw HTML and other unsupported inline content are not title evidence.
  return null;
}

const normalize = (text: string) => text.replace(/\r\n?/gu, '\n').trim();

/** Compare only the first complete prose/title block, never arbitrary matching text. */
export function publishingBodyStartsWithTitle(body: string, format: 'markdown' | 'plain', title: string): boolean {
  const expected = normalize(title);
  if (!expected) return false;
  if (format === 'plain') return normalize(normalize(body).split(/\n[\t ]*\n/u)[0] ?? '') === expected;
  const first = contentMarkdownTree(body).children.find((node) => node.type !== 'definition');
  if (!first || (first.type !== 'paragraph' && first.type !== 'heading')) return false;
  const parts = first.children.map(inlineText);
  return !parts.includes(null) && normalize(parts.join('')) === expected;
}
