import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { linkCardTarget } from '@/shared/contracts/link-card';

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

function elements(root: HtmlNode, tag: string) {
  const result: HtmlElement[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node && node.tagName === tag) result.push(node);
    if ('childNodes' in node) pending.push(...node.childNodes.slice().reverse());
  }
  return result;
}

function attribute(node: HtmlElement, name: string) {
  return node.attrs.find((attr) => attr.name === name)?.value ?? '';
}

function textContent(root: HtmlNode) {
  const output: string[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node && ['script', 'style', 'template'].includes(node.tagName)) continue;
    if (node.nodeName === '#text') output.push((node as DefaultTreeAdapterTypes.TextNode).value);
    else if ('tagName' in node && node.tagName === 'br') output.push('\n');
    else if ('childNodes' in node) pending.push(...node.childNodes.slice().reverse());
  }
  return output.join('').trim();
}

export function openGraphMetadata(html: string, url: string) {
  const document = parse(html);
  const head = elements(document, 'head')[0];
  const meta = new Map<string, string>();
  if (head)
    for (const node of elements(head, 'meta')) {
      const key = (attribute(node, 'property') || attribute(node, 'name')).toLowerCase();
      const value = attribute(node, 'content').trim();
      if (value && !meta.has(key)) meta.set(key, value);
    }
  const title =
    meta.get('og:title') || meta.get('twitter:title') || (head && elements(head, 'title').map(textContent)[0]) || '';
  const source =
    meta.get('og:image:secure_url') ||
    meta.get('og:image') ||
    meta.get('og:image:url') ||
    meta.get('twitter:image') ||
    meta.get('twitter:image:src');
  let imageUrl: string | null = null;
  if (source) {
    try {
      const target = linkCardTarget(new URL(source, url).href);
      if (target && target.kind !== 'CODEX') imageUrl = target.url;
    } catch {
      /* Missing or malformed artwork still leaves a useful title. */
    }
  }
  return {
    title: title.replace(/\s+/gu, ' ').slice(0, 500),
    siteName: (meta.get('og:site_name') || new URL(url).hostname).slice(0, 200),
    imageUrl,
  };
}

/** oEmbed HTML is input data only. No markup or third-party scripts enter the renderer. */
export function tweetQuote(html: string) {
  const fragment = parseFragment(html);
  const quote = elements(fragment, 'blockquote').find((node) =>
    attribute(node, 'class').split(/\s+/u).includes('twitter-tweet'),
  );
  if (!quote) return null;
  const paragraphs = elements(quote, 'p');
  return paragraphs.map(textContent).filter(Boolean).join('\n\n').slice(0, 20_000) || null;
}
