import { unified, type Plugin } from 'unified';
import * as remarkGfmModule from 'remark-gfm';
import * as remarkParseModule from 'remark-parse';
import { matchAdjacentCjkStrongMarkdown } from '@/shared/cjk-strong-markdown';

interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  align?: Array<'left' | 'right' | 'center' | null>;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

export interface ArticleWechatImageSource {
  src: string;
  width: number;
  height: number;
}

export interface ArticleWechatRenderOptions {
  linksAsEndReferences: boolean;
  referenceTitle: string;
}

export interface ArticleWechatRenderDiagnostics {
  htmlByteSize: number;
  textByteSize: number;
  linkCount: number;
  endReferenceCount: number;
  unsupportedLinkCount: number;
  localImageCount: number;
  remoteImageCount: number;
  unavailableImageCount: number;
}

export interface ArticleWechatRenderResult {
  html: string;
  text: string;
  diagnostics: ArticleWechatRenderDiagnostics;
}

interface EndReference {
  index: number;
  label: string;
  url: string;
}

interface RenderContext {
  imagesByPath: ReadonlyMap<string, ArticleWechatImageSource>;
  options: ArticleWechatRenderOptions;
  references: EndReference[];
  referencesByUrl: Map<string, EndReference>;
  linkCount: number;
  unsupportedLinkCount: number;
  unavailableImagePaths: Set<string>;
}

function resolveUnifiedPlugin(module: unknown, name: string): Plugin {
  let candidate = module;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate === 'function') return candidate as Plugin;
    if (!candidate || typeof candidate !== 'object' || !('default' in candidate)) break;
    candidate = candidate.default;
  }
  throw new TypeError(`${name} did not expose a Unified plugin`);
}

const remarkGfm = resolveUnifiedPlugin(remarkGfmModule, 'remark-gfm');
const remarkParse = resolveUnifiedPlugin(remarkParseModule, 'remark-parse');

function recoverAdjacentCjkStrongText(node: MarkdownNode) {
  const value = node.value ?? '';
  const recovered: MarkdownNode[] = [];
  let cursor = 0;
  let searchFrom = 0;

  while (searchFrom < value.length) {
    const markerIndex = value.indexOf('**', searchFrom);
    if (markerIndex < 0) break;

    const match = matchAdjacentCjkStrongMarkdown(value.slice(markerIndex));
    if (!match) {
      searchFrom = markerIndex + 2;
      continue;
    }

    if (markerIndex > cursor) recovered.push({ type: 'text', value: value.slice(cursor, markerIndex) });
    recovered.push({ type: 'strong', children: [{ type: 'text', value: match.text }] });
    if (match.trailingWhitespace) recovered.push({ type: 'text', value: match.trailingWhitespace });
    cursor = markerIndex + match.raw.length;
    searchFrom = cursor;
  }

  if (!recovered.length) return [node];
  if (cursor < value.length) recovered.push({ type: 'text', value: value.slice(cursor) });
  return recovered;
}

/** Keep WeChat rendering aligned with the editor's CJK-aware strong tokenizer. */
function recoverAdjacentCjkStrongMarks(node: MarkdownNode): MarkdownNode {
  if (!node.children?.length || node.type === 'strong') return node;
  return {
    ...node,
    children: node.children.flatMap((child) =>
      child.type === 'text' ? recoverAdjacentCjkStrongText(child) : [recoverAdjacentCjkStrongMarks(child)],
    ),
  };
}

function parseMarkdown(markdown: string) {
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MarkdownNode;
  return recoverAdjacentCjkStrongMarks(root);
}

function visitMarkdown(node: MarkdownNode, visitor: (candidate: MarkdownNode) => void) {
  visitor(node);
  for (const child of node.children ?? []) visitMarkdown(child, visitor);
}

function resolveMarkdownReferences(root: MarkdownNode) {
  const definitions = new Map<string, MarkdownNode>();
  visitMarkdown(root, (node) => {
    if (node.type === 'definition' && node.identifier && node.url) {
      definitions.set(node.identifier.toLocaleLowerCase(), node);
    }
  });
  const resolve = (node: MarkdownNode): MarkdownNode => {
    const definition = node.identifier ? definitions.get(node.identifier.toLocaleLowerCase()) : undefined;
    if (definition && (node.type === 'imageReference' || node.type === 'linkReference')) {
      return {
        ...node,
        type: node.type === 'imageReference' ? 'image' : 'link',
        url: definition.url,
        title: definition.title,
        children: node.children?.map(resolve),
      };
    }
    return node.children ? { ...node, children: node.children.map(resolve) } : node;
  };
  return resolve(root);
}

export function normalizeArticleWechatMediaPath(value: string) {
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function articleImageSourceRequiresMediaBinding(value: string) {
  return safeHttpsUrl(value) === null;
}

function isWechatArticleUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLocaleLowerCase() === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const publicationPalette = {
  accent: '#80566a',
  accentStrong: '#6e4052',
  accentBorder: '#e3d2da',
  accentSurface: '#faf7f8',
  codeText: '#3f3838',
  neutralBorder: '#dedad2',
  surface: '#f8f7f3',
  text: '#4a453e',
  textStrong: '#302b29',
  textMuted: '#6c665e',
} as const;

const styles = {
  container:
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;" +
    `font-size:16px;line-height:1.9;color:${publicationPalette.text};letter-spacing:0.015em;word-break:break-word;` +
    'text-align:left;-webkit-font-smoothing:antialiased;',
  paragraph: 'margin:0 0 1.25em;line-height:1.9;color:inherit;',
  heading2:
    `margin:2.15em 0 0.95em;padding:0 0 0.5em;border-bottom:1px solid ${publicationPalette.accentBorder};` +
    `font-size:22px;line-height:1.45;font-weight:700;color:${publicationPalette.accent};letter-spacing:0.01em;`,
  heading3:
    `margin:1.9em 0 0.85em;padding-left:0.7em;border-left:3px solid ${publicationPalette.accent};` +
    `font-size:19px;line-height:1.5;font-weight:700;color:${publicationPalette.accent};`,
  heading4: `margin:1.7em 0 0.75em;font-size:17px;line-height:1.55;font-weight:700;color:${publicationPalette.accentStrong};`,
  list: `margin:0 0 1.25em;padding-left:1.6em;color:${publicationPalette.text};list-style-position:outside;`,
  nestedList: `margin:0.4em 0 0.25em;padding-left:1.5em;color:${publicationPalette.text};list-style-position:outside;`,
  listItem: 'margin:0.45em 0;padding-left:0.1em;line-height:1.85;',
  listParagraph: 'margin:0;line-height:1.85;color:inherit;',
  listContinuationParagraph: 'margin:0.5em 0 0;line-height:1.85;color:inherit;',
  taskMarker: `display:inline-block;margin-right:0.45em;color:${publicationPalette.accent};`,
  quote:
    `margin:1.6em 0;padding:1em 1.1em;border-left:3px solid ${publicationPalette.accent};` +
    `background-color:${publicationPalette.accentSurface};color:${publicationPalette.textMuted};`,
  quoteParagraph: 'margin:0;line-height:1.85;color:inherit;',
  inlineCode:
    `margin:0 0.15em;padding:0.12em 0.4em;background-color:${publicationPalette.surface};` +
    `color:${publicationPalette.codeText};font-family:Consolas,Monaco,monospace;font-size:0.9em;border-radius:3px;`,
  code:
    `display:block;margin:1.6em 0;padding:1.1em;overflow-wrap:anywhere;white-space:pre-wrap;` +
    `border:1px solid ${publicationPalette.neutralBorder};border-radius:6px;background-color:${publicationPalette.surface};` +
    `color:${publicationPalette.codeText};font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.7;`,
  image: 'display:block;max-width:100%;height:auto;margin:1.65em auto;border-radius:6px;',
  link: `color:${publicationPalette.accent};text-decoration:underline;text-underline-offset:0.18em;`,
  referenceMarker: 'margin-left:0.16em;font-size:0.72em;line-height:0;vertical-align:super;',
  referenceList: `margin:0 0 1.25em;font-size:14px;line-height:1.85;color:${publicationPalette.textMuted};`,
  referenceIndex: 'font-family:Consolas,Monaco,monospace;font-size:0.9em;opacity:0.7;',
  referenceUrl: 'word-break:break-all;font-style:italic;',
  tableViewport:
    `display:block;width:100%;max-width:100%;margin:1.6em 0;overflow-x:auto;overflow-y:hidden;` +
    'border-radius:6px;-webkit-overflow-scrolling:touch;',
  table:
    'width:max-content;min-width:100%;max-width:none;margin:0;border-collapse:collapse;table-layout:auto;' +
    'font-size:14px;line-height:1.7;',
  tableHeader:
    `padding:0.75em 0.85em;border:1px solid ${publicationPalette.accentBorder};` +
    `background-color:${publicationPalette.accentSurface};color:${publicationPalette.accentStrong};` +
    'font-weight:700;vertical-align:top;white-space:nowrap;word-break:keep-all;',
  tableCell:
    `padding:0.75em 0.85em;border:1px solid ${publicationPalette.neutralBorder};color:${publicationPalette.text};` +
    'vertical-align:top;white-space:nowrap;word-break:keep-all;',
  separator: `width:4em;margin:2.4em auto;border:0;border-top:2px solid ${publicationPalette.accentBorder};`,
} as const;

function renderChildren(node: MarkdownNode, context: RenderContext) {
  return (node.children ?? []).map((child) => renderNode(child, context)).join('');
}

function paragraphOnlyContainsImages(node: MarkdownNode) {
  const meaningfulChildren = (node.children ?? []).filter(
    (child) => child.type !== 'text' || Boolean(child.value?.trim()),
  );
  return meaningfulChildren.length > 0 && meaningfulChildren.every((child) => child.type === 'image');
}

function renderQuoteChildren(node: MarkdownNode, context: RenderContext) {
  const children = node.children ?? [];
  return children
    .map((child, index) => {
      if (child.type !== 'paragraph') return renderNode(child, context);
      const spacing = index < children.length - 1 ? 'margin-bottom:0.7em;' : '';
      return `<p style="${styles.quoteParagraph}${spacing}">${renderChildren(child, context)}</p>`;
    })
    .join('');
}

function renderImage(node: MarkdownNode, context: RenderContext) {
  const source = node.url ?? '';
  const normalizedPath = normalizeArticleWechatMediaPath(source);
  const prepared = context.imagesByPath.get(normalizedPath);
  const remoteSource = prepared ? null : safeHttpsUrl(source);
  const imageSource = prepared?.src ?? remoteSource;
  const alt = node.alt?.trim() ?? '';
  if (!imageSource) {
    context.unavailableImagePaths.add(normalizedPath);
    return alt ? `<span>${escapeHtml(alt)}</span>` : '';
  }
  const dimensions =
    prepared && prepared.width > 0 && prepared.height > 0
      ? ` width="${prepared.width}" height="${prepared.height}"`
      : '';
  const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
  return `<img src="${escapeHtml(imageSource)}" alt="${escapeHtml(alt)}"${title}${dimensions} style="${styles.image}">`;
}

function renderTable(node: MarkdownNode, context: RenderContext) {
  const rows = node.children ?? [];
  const renderRow = (row: MarkdownNode, header: boolean) => {
    const cells = (row.children ?? []).map((cell, index) => {
      const tag = header ? 'th' : 'td';
      const alignment = node.align?.[index];
      const style = `${header ? styles.tableHeader : styles.tableCell}${alignment ? `text-align:${alignment};` : ''}`;
      return `<${tag} style="${style}">${renderChildren(cell, context)}</${tag}>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  };
  const header = rows[0] ? `<thead>${renderRow(rows[0], true)}</thead>` : '';
  const body =
    rows.length > 1
      ? `<tbody>${rows
          .slice(1)
          .map((row) => renderRow(row, false))
          .join('')}</tbody>`
      : '';
  return `<section style="${styles.tableViewport}"><table style="${styles.table}">${header}${body}</table></section>`;
}

const unorderedListStyleTypes = ['disc', 'circle', 'square'] as const;
const orderedListStyleTypes = ['decimal', 'lower-alpha', 'lower-roman'] as const;

function renderList(node: MarkdownNode, context: RenderContext, depth: number): string {
  const tag = node.ordered ? 'ol' : 'ul';
  const start = node.ordered && node.start && node.start > 1 ? ` start="${node.start}"` : '';
  const styleTypes = node.ordered ? orderedListStyleTypes : unorderedListStyleTypes;
  const styleType = styleTypes[Math.min(depth, styleTypes.length - 1)];
  const style = `${depth === 0 ? styles.list : styles.nestedList}list-style-type:${styleType};`;
  const items = (node.children ?? []).map((item) => renderListItem(item, context, depth)).join('');
  return `<${tag}${start} style="${style}">${items}</${tag}>`;
}

function renderListItem(node: MarkdownNode, context: RenderContext, depth: number): string {
  const checked = node.checked !== null && node.checked !== undefined;
  const taskMarker = checked ? `<span style="${styles.taskMarker}">${node.checked ? '☑' : '☐'}</span>` : '';
  let markerPending = checked;
  let paragraphIndex = 0;
  const body = (node.children ?? [])
    .map((child) => {
      if (child.type === 'list') return renderList(child, context, depth + 1);
      if (child.type === 'paragraph') {
        const marker = markerPending ? taskMarker : '';
        markerPending = false;
        const style = paragraphIndex === 0 ? styles.listParagraph : styles.listContinuationParagraph;
        paragraphIndex += 1;
        return `<p style="${style}">${marker}${renderChildren(child, context)}</p>`;
      }
      return renderNode(child, context);
    })
    .join('');
  const remainingMarker = markerPending ? taskMarker : '';
  const itemStyle = `${styles.listItem}${checked ? 'list-style-type:none;' : ''}`;
  return `<li style="${itemStyle}">${remainingMarker}${body}</li>`;
}

function referenceForLink(node: MarkdownNode, href: string, context: RenderContext) {
  if (!context.options.linksAsEndReferences || isWechatArticleUrl(href)) return null;
  const plainLabel = (node.children ?? [])
    .map((child) => renderPlainInline(child, context))
    .join('')
    .trim();
  if (!plainLabel || plainLabel === node.url || plainLabel === href) return null;
  const existing = context.referencesByUrl.get(href);
  if (existing) return existing;
  const reference = {
    index: context.references.length + 1,
    label: node.title?.trim() || plainLabel,
    url: href,
  };
  context.references.push(reference);
  context.referencesByUrl.set(href, reference);
  return reference;
}

function renderInlineNode(node: MarkdownNode, context: RenderContext): string | null {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value ?? '');
    case 'strong':
      return `<strong style="font-weight:700;color:${publicationPalette.textStrong};">${renderChildren(node, context)}</strong>`;
    case 'emphasis':
      return `<em style="font-style:italic;">${renderChildren(node, context)}</em>`;
    case 'delete':
      return `<s>${renderChildren(node, context)}</s>`;
    case 'inlineCode':
      return `<code style="${styles.inlineCode}">${escapeHtml(node.value ?? '')}</code>`;
    case 'link': {
      context.linkCount += 1;
      const href = safeHttpsUrl(node.url ?? '');
      const label = renderChildren(node, context);
      if (!href) {
        context.unsupportedLinkCount += 1;
        return label;
      }
      const reference = referenceForLink(node, href, context);
      const marker = reference ? `<sup style="${styles.referenceMarker}">[${reference.index}]</sup>` : '';
      return `<a href="${escapeHtml(href)}" style="${styles.link}">${label}${marker}</a>`;
    }
    case 'image':
      return renderImage(node, context);
    case 'break':
      return '<br>';
    case 'html':
      return escapeHtml(node.value ?? '');
    default:
      return null;
  }
}

function renderBlockNode(node: MarkdownNode, context: RenderContext): string {
  switch (node.type) {
    case 'root':
      return renderChildren(node, context);
    case 'paragraph':
      return `<p style="${paragraphOnlyContainsImages(node) ? 'margin:0;line-height:1;' : styles.paragraph}">${renderChildren(node, context)}</p>`;
    case 'heading': {
      const level = node.depth === 1 || node.depth === 2 ? 2 : node.depth === 3 ? 3 : 4;
      const style = level === 2 ? styles.heading2 : level === 3 ? styles.heading3 : styles.heading4;
      return `<h${level} style="${style}">${renderChildren(node, context)}</h${level}>`;
    }
    case 'code':
      return `<pre style="${styles.code}"><code>${escapeHtml(node.value ?? '')}</code></pre>`;
    case 'blockquote':
      return `<blockquote style="${styles.quote}">${renderQuoteChildren(node, context)}</blockquote>`;
    case 'list':
      return renderList(node, context, 0);
    case 'listItem':
      return renderListItem(node, context, 0);
    case 'thematicBreak':
      return `<hr style="${styles.separator}">`;
    case 'table':
      return renderTable(node, context);
    case 'tableRow':
    case 'tableCell':
      return renderChildren(node, context);
    case 'definition':
      return '';
    default:
      return node.children ? renderChildren(node, context) : escapeHtml(node.value ?? '');
  }
}

function renderNode(node: MarkdownNode, context: RenderContext): string {
  return renderInlineNode(node, context) ?? renderBlockNode(node, context);
}

function renderPlainInline(node: MarkdownNode, context: RenderContext): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value ?? '';
    case 'image':
      return node.alt?.trim() ? `【${node.alt.trim()}】` : '【图片】';
    case 'link': {
      const label = (node.children ?? []).map((child) => renderPlainInline(child, context)).join('');
      const href = safeHttpsUrl(node.url ?? '');
      if (!href) return label;
      const reference = referenceForLink(node, href, context);
      if (reference) return `${label}[${reference.index}]`;
      return href !== label ? `${label}（${href}）` : label || href;
    }
    case 'break':
      return '\n';
    case 'html':
      return node.value ?? '';
    default:
      return (node.children ?? []).map((child) => renderPlainInline(child, context)).join('') || node.value || '';
  }
}

const unorderedPlainMarkers = ['•', '◦', '▪'] as const;

function renderPlainList(node: MarkdownNode, context: RenderContext, depth: number): string {
  return (node.children ?? [])
    .map((item, index) => {
      const taskMarker = item.checked === null || item.checked === undefined ? null : item.checked ? '☑' : '☐';
      const marker = node.ordered
        ? `${(node.start ?? 1) + index}.`
        : (taskMarker ?? unorderedPlainMarkers[Math.min(depth, unorderedPlainMarkers.length - 1)]);
      return renderPlainListItem(item, marker, context, depth);
    })
    .join('\n');
}

function renderPlainListItem(node: MarkdownNode, marker: string, context: RenderContext, depth: number): string {
  const indent = '  '.repeat(depth);
  const firstPrefix = `${indent}${marker} `;
  const continuationPrefix = `${indent}${' '.repeat(marker.length + 1)}`;
  const body = (node.children ?? [])
    .filter((child) => child.type !== 'list')
    .map((child) => renderPlainBlock(child, context))
    .filter(Boolean)
    .join('\n');
  const bodyLines = body ? body.split('\n') : [];
  const ownLines = bodyLines.length
    ? bodyLines.map((line, index) => `${index === 0 ? firstPrefix : continuationPrefix}${line}`).join('\n')
    : firstPrefix.trimEnd();
  const nestedLists = (node.children ?? [])
    .filter((child) => child.type === 'list')
    .map((child) => renderPlainList(child, context, depth + 1));
  return [ownLines, ...nestedLists].filter(Boolean).join('\n');
}

function renderPlainBlock(node: MarkdownNode, context: RenderContext): string {
  switch (node.type) {
    case 'root':
      return (node.children ?? [])
        .map((child) => renderPlainBlock(child, context))
        .filter(Boolean)
        .join('\n\n');
    case 'paragraph':
    case 'heading':
      return (node.children ?? [])
        .map((child) => renderPlainInline(child, context))
        .join('')
        .trim();
    case 'code':
      return node.value?.trimEnd() ?? '';
    case 'blockquote':
      return (node.children ?? [])
        .map((child) => renderPlainBlock(child, context))
        .filter(Boolean)
        .join('\n');
    case 'list':
      return renderPlainList(node, context, 0);
    case 'listItem': {
      const marker = node.checked === null || node.checked === undefined ? '' : node.checked ? '☑ ' : '☐ ';
      return `${marker}${(node.children ?? [])
        .map((child) => renderPlainBlock(child, context))
        .filter(Boolean)
        .join('\n')}`;
    }
    case 'table':
      return (node.children ?? [])
        .map((row) => (row.children ?? []).map((cell) => renderPlainInline(cell, context).trim()).join('\t'))
        .join('\n');
    case 'thematicBreak':
      return '——';
    case 'definition':
      return '';
    default:
      return renderPlainInline(node, context).trim();
  }
}

function visibleArticleRoot(root: MarkdownNode) {
  const children = root.children ?? [];
  const first = children[0];
  return first?.type === 'heading' && first.depth === 1 ? { ...root, children: children.slice(1) } : root;
}

function articleRoot(markdown: string) {
  return visibleArticleRoot(resolveMarkdownReferences(parseMarkdown(markdown)));
}

function imageReferences(root: MarkdownNode) {
  const localImagePaths = new Set<string>();
  const remoteImageUrls = new Set<string>();
  visitMarkdown(root, (node) => {
    if (node.type !== 'image' || !node.url) return;
    const remoteUrl = safeHttpsUrl(node.url);
    if (remoteUrl) remoteImageUrls.add(remoteUrl);
    else localImagePaths.add(normalizeArticleWechatMediaPath(node.url));
  });
  return { localImagePaths: [...localImagePaths], remoteImageUrls: [...remoteImageUrls] };
}

export function articleWechatImageReferences(markdown: string) {
  return imageReferences(articleRoot(markdown));
}

export function articleMarkdownImageReferences(markdown: string) {
  return imageReferences(resolveMarkdownReferences(parseMarkdown(markdown)));
}

/** Keep occurrences separate: a repeated media path is not a unique editable placement. */
export function articleMarkdownImageOccurrences(markdown: string) {
  const paths: string[] = [];
  visitMarkdown(resolveMarkdownReferences(parseMarkdown(markdown)), (node) => {
    if (node.type === 'image' && node.url) paths.push(normalizeArticleWechatMediaPath(node.url));
  });
  return paths;
}

export function articleIllustrationBlocks(markdown: string) {
  return (parseMarkdown(markdown).children ?? []).flatMap((node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return ['paragraph', 'heading', 'blockquote', 'list'].includes(node.type) &&
      start !== undefined &&
      end !== undefined
      ? [{ start, end }]
      : [];
  });
}

export function articleIllustrationInsertionOffset(
  markdown: string,
  selectedText: string,
  blocks?: readonly { start: number; end: number }[],
) {
  if (!selectedText) return null;
  const start = markdown.indexOf(selectedText);
  if (start < 0 || start !== markdown.lastIndexOf(selectedText)) return null;
  const end = start + selectedText.length;
  return (
    (blocks ?? articleIllustrationBlocks(markdown)).find((block) => block.start <= start && block.end >= end)?.end ??
    null
  );
}

export function replaceSingleArticleMarkdownImage(markdown: string, previousPath: string, nextPath: string) {
  const matches: MarkdownNode[] = [];
  visitMarkdown(resolveMarkdownReferences(parseMarkdown(markdown)), (node) => {
    if (node.type === 'image' && node.url && normalizeArticleWechatMediaPath(node.url) === previousPath) {
      matches.push(node);
    }
  });
  const node = matches.length === 1 ? matches[0] : undefined;
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  if (!node || start === undefined || end === undefined) {
    throw new Error('The illustration position is missing or ambiguous; select its position in the article');
  }
  const alt = (node.alt ?? '').replace(/[\\[\]]/gu, '\\$&');
  const title = node.title ? ` "${node.title.replace(/[\\"]/gu, '\\$&')}"` : '';
  return `${markdown.slice(0, start)}![${alt}](${nextPath}${title})${markdown.slice(end)}`;
}

export function removeUnboundArticleMarkdownImages(markdown: string, boundMediaPaths: readonly string[]) {
  const boundPaths = new Set(boundMediaPaths.map(normalizeArticleWechatMediaPath));
  const removals: Array<{ start: number; end: number }> = [];
  visitMarkdown(resolveMarkdownReferences(parseMarkdown(markdown)), (node) => {
    if (
      node.type !== 'image' ||
      !node.url ||
      !articleImageSourceRequiresMediaBinding(node.url) ||
      boundPaths.has(normalizeArticleWechatMediaPath(node.url))
    ) {
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < 0 || end > markdown.length || start >= end) return;
    removals.push({ start, end });
  });
  let normalized = markdown;
  for (const removal of removals.sort((left, right) => right.start - left.start)) {
    normalized = `${normalized.slice(0, removal.start)}${normalized.slice(removal.end)}`;
  }
  return normalized;
}

function renderEndReferences(references: readonly EndReference[], title: string) {
  if (!references.length) return '';
  const rows = references
    .map((reference) => {
      const label = reference.label === reference.url ? '' : `${escapeHtml(reference.label)}：`;
      return `<code style="${styles.referenceIndex}">[${reference.index}]</code> ${label}<i style="${styles.referenceUrl}">${escapeHtml(reference.url)}</i><br>`;
    })
    .join('');
  return `<h4 style="${styles.heading4}">${escapeHtml(title)}</h4><p style="${styles.referenceList}">${rows}</p>`;
}

function renderPlainEndReferences(references: readonly EndReference[], title: string) {
  if (!references.length) return '';
  const rows = references.map((reference) => {
    const label = reference.label === reference.url ? '' : `${reference.label}：`;
    return `[${reference.index}] ${label}${reference.url}`;
  });
  return [title, ...rows].join('\n');
}

function utf8ByteSize(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function renderArticleForWechat(
  markdown: string,
  imagesByPath: ReadonlyMap<string, ArticleWechatImageSource>,
  options: ArticleWechatRenderOptions,
): ArticleWechatRenderResult {
  const root = articleRoot(markdown);
  const references = imageReferences(root);
  const context: RenderContext = {
    imagesByPath,
    options,
    references: [],
    referencesByUrl: new Map(),
    linkCount: 0,
    unsupportedLinkCount: 0,
    unavailableImagePaths: new Set(),
  };
  const body = renderNode(root, context);
  const appendix = renderEndReferences(context.references, options.referenceTitle);
  const html = `<section style="${styles.container}">${body}${appendix}</section>`;
  const plainBody = renderPlainBlock(root, context).trim();
  const plainAppendix = renderPlainEndReferences(context.references, options.referenceTitle);
  const text = [plainBody, plainAppendix].filter(Boolean).join('\n\n');
  return {
    html,
    text,
    diagnostics: {
      htmlByteSize: utf8ByteSize(html),
      textByteSize: utf8ByteSize(text),
      linkCount: context.linkCount,
      endReferenceCount: context.references.length,
      unsupportedLinkCount: context.unsupportedLinkCount,
      localImageCount: references.localImagePaths.length,
      remoteImageCount: references.remoteImageUrls.length,
      unavailableImageCount: context.unavailableImagePaths.size,
    },
  };
}
