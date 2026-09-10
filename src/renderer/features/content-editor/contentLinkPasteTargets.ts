import type { Slice } from '@tiptap/pm/model';
import { linkCardAttributesSchema, linkCardTarget, type LinkCardAttributes } from '@/shared/contracts/link-card';
import { paragraphLinkCard } from '@/shared/link-card-document';

/** Web links share the chooser; application protocols still require their enabled provider. */
export function pastedWebLinks(text: string, slice: Slice): LinkCardAttributes[] | null {
  if (text.length > 100_000 || slice.content.childCount > 100) return null;
  const paragraphs = slice.content.content.map((node) => {
    const attributes = paragraphLinkCard(node.toJSON())?.attrs;
    // Preserve the pasted label until the user actually chooses a card.
    return attributes ? { ...attributes, title: attributes.title ? node.textContent : null } : null;
  });
  if (paragraphs.length && paragraphs.every(Boolean)) {
    const parsed = linkCardAttributesSchema.array().safeParse(paragraphs);
    return parsed.success && parsed.data.every((link) => /^https?:\/\//iu.test(link.url)) ? parsed.data : null;
  }

  const value = text.trim();
  const lines = value
    .split(/\r\n?|\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length && lines.length <= 100) {
    const links: LinkCardAttributes[] = [];
    for (const line of lines) {
      const target = linkCardTarget(line.startsWith('<') && line.endsWith('>') ? line.slice(1, -1) : line);
      if (!target || !/^https?:\/\//iu.test(target.url)) break;
      links.push({ url: target.url });
    }
    if (links.length === lines.length) return links;
  }

  // Pasted X embed snippets offer the same choice without inserting or executing their HTML.
  if (!/^<blockquote\b/iu.test(value)) return null;
  const template = document.createElement('template');
  template.innerHTML = value;
  const quote = template.content.querySelector('blockquote.twitter-tweet');
  const target = Array.from(quote?.querySelectorAll('a[href]') ?? [])
    .reverse()
    .map((link) => linkCardTarget(link.getAttribute('href')))
    .find((link) => link?.kind === 'X');
  return target ? [{ url: target.url }] : null;
}
