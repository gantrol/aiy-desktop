import type { JSONContent } from '@tiptap/core';
import { linkCardAttributesSchema, linkCardTarget } from '@/shared/contracts/link-card';

/** Explicit conversion accepts a complete link-only paragraph; prose, headings, lists and code keep their text. */
export function paragraphLinkCard(node: JSONContent): JSONContent | null {
  if (node.type !== 'paragraph' || !node.content?.length) return null;
  if (node.content.some((child) => child.type !== 'text' || child.marks?.some((mark) => mark.type !== 'link')))
    return null;
  const text = node.content
    .map((child) => child.text ?? '')
    .join('')
    .trim();
  const links = node.content.map((child) => child.marks?.find((mark) => mark.type === 'link')?.attrs?.href);
  const href = links[0] && links.every((link) => link === links[0]) ? links[0] : text;
  const target = linkCardTarget(href);
  if (!target) return null;
  return {
    type: 'linkCard',
    attrs: { ...node.attrs, url: target.url, title: text === href ? null : text.replace(/\s+/gu, ' ').slice(0, 500) },
  };
}

export function linkCardMarkdown(node: JSONContent): string {
  const parsed = linkCardAttributesSchema.safeParse(node.attrs);
  if (!parsed.success) return '';
  const { url, title } = parsed.data;
  const label = (title || url).replace(/[\\\[\]]/gu, '\\$&');
  return `[${label}](<${url.replace(/>/gu, '%3E')}>)`;
}
