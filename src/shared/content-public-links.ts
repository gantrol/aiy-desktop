import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { RootContent } from 'mdast';
import { contentMarkdownTree } from '@/shared/content-markdown';
import { contentFigureReferenceAssetId } from '@/shared/content-figure-reference';

function privateTarget(raw: string) {
  const value = [...raw.trim()].filter((character) => character.charCodeAt(0) > 32).join('');
  if (contentFigureReferenceAssetId(value)) return false;
  if (/^(?:aiy(?:-[a-z-]+)?:|codex:|file:|#aiy-block:|[a-z]:[\\/]|\\\\)/iu.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|\[::1\]$|\[(?:fc|fd|fe80:))/u.test(host)
    );
  } catch {
    return false;
  }
}

/** Publication is not permission to expose application-local navigation or credential-bearing URLs. */
export function unresolvedPublicLinks(markdown: string) {
  const links: { url: string; start: number }[] = [];
  const add = (url: string, start = 0) => {
    if (privateTarget(url) && links.length < 20) links.push({ url, start });
  };
  const visitHtml = (node: DefaultTreeAdapterMap['node'], start: number) => {
    if ('attrs' in node)
      for (const attr of node.attrs) if (['href', 'src', 'action'].includes(attr.name)) add(attr.value, start);
    if ('childNodes' in node) node.childNodes.forEach((child) => visitHtml(child, start));
  };
  const visit = (node: RootContent) => {
    const start = node.position?.start.offset ?? 0;
    if (node.type === 'link' || node.type === 'definition' || node.type === 'image') add(node.url, start);
    if (node.type === 'html') visitHtml(parseFragment(node.value), start);
    if ('children' in node) node.children.forEach((child) => visit(child as RootContent));
  };
  contentMarkdownTree(markdown).children.forEach(visit);
  return links;
}

export function assertPublicContentLinks(markdown: string) {
  if (unresolvedPublicLinks(markdown).length)
    throw Object.assign(new Error('REFERENCE_PUBLIC_LINK_UNRESOLVED'), { code: 'REFERENCE_PUBLIC_LINK_UNRESOLVED' });
}
