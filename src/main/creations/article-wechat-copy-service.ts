import { unified, type Plugin } from 'unified';
import * as remarkGfmModule from 'remark-gfm';
import * as remarkParseModule from 'remark-parse';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import type { ArticleCopyForWechatInput, ArticleCopyForWechatResult, ArticleDto } from '@/shared/contracts';

const MAX_WECHAT_CLIPBOARD_MEDIA_BYTES = 96 * 1024 * 1024;
const MAX_WECHAT_CLIPBOARD_HTML_BYTES = 132 * 1024 * 1024;

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
}

interface PreparedWechatImage {
  dataUrl: string;
  width: number;
  height: number;
}

interface ArticleWechatCopyDatabase {
  getArticle(id: string): ArticleDto;
  resolveAssetFile(assetId: string): ResolvedAssetFile | null;
}

export interface ArticleWechatCopyPorts {
  writeClipboard(data: { html: string; text: string }): void;
  convertWebpBytesToPng(bytes: Buffer): Promise<Buffer | null>;
  convertSvgBytesToPng(bytes: Buffer): Promise<Buffer | null>;
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

function parseMarkdown(markdown: string) {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MarkdownNode;
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

function normalizeMediaPath(value: string) {
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const styles = {
  container:
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;" +
    'font-size:16px;line-height:1.8;color:#262626;letter-spacing:0.02em;word-break:break-word;',
  paragraph: 'margin:0 0 1.15em;line-height:1.8;color:#262626;',
  heading2:
    'margin:1.8em 0 0.8em;padding:0 0 0.4em;border-bottom:1px solid #ded9cf;font-size:22px;line-height:1.4;' +
    'font-weight:700;color:#1f1f1f;',
  heading3: 'margin:1.6em 0 0.7em;font-size:19px;line-height:1.45;font-weight:700;color:#242424;',
  heading4: 'margin:1.45em 0 0.65em;font-size:17px;line-height:1.5;font-weight:700;color:#2b2b2b;',
  list: 'margin:0 0 1.15em;padding-left:1.5em;color:#262626;',
  listItem: 'margin:0.35em 0;line-height:1.75;',
  quote: 'margin:1.25em 0;padding:0.8em 1em;border-left:3px solid #8a7960;background-color:#f7f5f0;' + 'color:#5a554d;',
  inlineCode:
    'margin:0 0.15em;padding:0.12em 0.35em;background-color:#f3f1ec;color:#4b4033;font-family:Consolas,Monaco,monospace;' +
    'font-size:0.9em;',
  code:
    'display:block;margin:1.25em 0;padding:1em;overflow-wrap:anywhere;white-space:pre-wrap;background-color:#f3f1ec;' +
    'color:#332f2a;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.65;',
  image: 'display:block;max-width:100%;height:auto;margin:1.4em auto;',
  link: 'color:#735f43;text-decoration:underline;text-underline-offset:0.18em;',
  table: 'width:100%;margin:1.25em 0;border-collapse:collapse;table-layout:fixed;font-size:14px;line-height:1.6;',
  tableHeader:
    'padding:0.65em 0.75em;border:1px solid #d8d3ca;background-color:#f3f1ec;font-weight:700;vertical-align:top;',
  tableCell: 'padding:0.65em 0.75em;border:1px solid #d8d3ca;vertical-align:top;word-break:break-word;',
  separator: 'margin:1.8em 0;border:0;border-top:1px solid #ded9cf;',
} as const;

function renderChildren(node: MarkdownNode, imagesByPath: ReadonlyMap<string, PreparedWechatImage>) {
  return (node.children ?? []).map((child) => renderNode(child, imagesByPath)).join('');
}

function renderImage(node: MarkdownNode, imagesByPath: ReadonlyMap<string, PreparedWechatImage>) {
  const source = node.url ?? '';
  const prepared = imagesByPath.get(normalizeMediaPath(source));
  const remoteSource = prepared ? null : safeHttpsUrl(source);
  const imageSource = prepared?.dataUrl ?? remoteSource;
  const alt = node.alt?.trim() ?? '';
  if (!imageSource) return alt ? `<span>${escapeHtml(alt)}</span>` : '';
  const dimensions = prepared ? ` width="${prepared.width}" height="${prepared.height}"` : '';
  const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
  return `<img src="${escapeHtml(imageSource)}" alt="${escapeHtml(alt)}"${title}${dimensions} style="${styles.image}">`;
}

function renderTable(node: MarkdownNode, imagesByPath: ReadonlyMap<string, PreparedWechatImage>) {
  const rows = node.children ?? [];
  const renderRow = (row: MarkdownNode, header: boolean) => {
    const cells = (row.children ?? []).map((cell, index) => {
      const tag = header ? 'th' : 'td';
      const alignment = node.align?.[index];
      const style = `${header ? styles.tableHeader : styles.tableCell}${alignment ? `text-align:${alignment};` : ''}`;
      return `<${tag} style="${style}">${renderChildren(cell, imagesByPath)}</${tag}>`;
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
  return `<table style="${styles.table}">${header}${body}</table>`;
}

function renderInlineNode(node: MarkdownNode, imagesByPath: ReadonlyMap<string, PreparedWechatImage>): string | null {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value ?? '');
    case 'strong':
      return `<strong style="font-weight:700;">${renderChildren(node, imagesByPath)}</strong>`;
    case 'emphasis':
      return `<em style="font-style:italic;">${renderChildren(node, imagesByPath)}</em>`;
    case 'delete':
      return `<s>${renderChildren(node, imagesByPath)}</s>`;
    case 'inlineCode':
      return `<code style="${styles.inlineCode}">${escapeHtml(node.value ?? '')}</code>`;
    case 'link': {
      const href = safeHttpsUrl(node.url ?? '');
      const label = renderChildren(node, imagesByPath);
      return href ? `<a href="${escapeHtml(href)}" style="${styles.link}">${label}</a>` : label;
    }
    case 'image':
      return renderImage(node, imagesByPath);
    case 'break':
      return '<br>';
    case 'html':
      return escapeHtml(node.value ?? '');
    default:
      return null;
  }
}

function renderBlockNode(node: MarkdownNode, imagesByPath: ReadonlyMap<string, PreparedWechatImage>): string {
  switch (node.type) {
    case 'root':
      return renderChildren(node, imagesByPath);
    case 'paragraph':
      return `<p style="${styles.paragraph}">${renderChildren(node, imagesByPath)}</p>`;
    case 'heading': {
      const level = node.depth === 1 || node.depth === 2 ? 2 : node.depth === 3 ? 3 : 4;
      const style = level === 2 ? styles.heading2 : level === 3 ? styles.heading3 : styles.heading4;
      return `<h${level} style="${style}">${renderChildren(node, imagesByPath)}</h${level}>`;
    }
    case 'code':
      return `<pre style="${styles.code}"><code>${escapeHtml(node.value ?? '')}</code></pre>`;
    case 'blockquote':
      return `<blockquote style="${styles.quote}">${renderChildren(node, imagesByPath)}</blockquote>`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const start = node.ordered && node.start && node.start > 1 ? ` start="${node.start}"` : '';
      return `<${tag}${start} style="${styles.list}">${renderChildren(node, imagesByPath)}</${tag}>`;
    }
    case 'listItem': {
      const marker = node.checked === null || node.checked === undefined ? '' : node.checked ? '☑ ' : '☐ ';
      return `<li style="${styles.listItem}">${marker}${renderChildren(node, imagesByPath)}</li>`;
    }
    case 'thematicBreak':
      return `<hr style="${styles.separator}">`;
    case 'table':
      return renderTable(node, imagesByPath);
    case 'tableRow':
    case 'tableCell':
      return renderChildren(node, imagesByPath);
    case 'definition':
      return '';
    default:
      return node.children ? renderChildren(node, imagesByPath) : escapeHtml(node.value ?? '');
  }
}

function renderNode(node: MarkdownNode, imagesByPath: ReadonlyMap<string, PreparedWechatImage>): string {
  return renderInlineNode(node, imagesByPath) ?? renderBlockNode(node, imagesByPath);
}

function renderPlainInline(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value ?? '';
    case 'image':
      return node.alt?.trim() ? `【${node.alt.trim()}】` : '【图片】';
    case 'link': {
      const label = (node.children ?? []).map(renderPlainInline).join('');
      const href = safeHttpsUrl(node.url ?? '');
      return href && href !== label ? `${label}（${href}）` : label || href || '';
    }
    case 'break':
      return '\n';
    case 'html':
      return node.value ?? '';
    default:
      return (node.children ?? []).map(renderPlainInline).join('') || node.value || '';
  }
}

function renderPlainBlock(node: MarkdownNode): string {
  switch (node.type) {
    case 'root':
      return (node.children ?? []).map(renderPlainBlock).filter(Boolean).join('\n\n');
    case 'paragraph':
    case 'heading':
      return (node.children ?? []).map(renderPlainInline).join('').trim();
    case 'code':
      return node.value?.trimEnd() ?? '';
    case 'blockquote':
      return (node.children ?? []).map(renderPlainBlock).filter(Boolean).join('\n');
    case 'list':
      return (node.children ?? [])
        .map((item, index) => {
          const marker = node.ordered ? `${(node.start ?? 1) + index}.` : '•';
          return `${marker} ${renderPlainBlock(item).trim()}`;
        })
        .join('\n');
    case 'listItem': {
      const marker = node.checked === null || node.checked === undefined ? '' : node.checked ? '☑ ' : '☐ ';
      return `${marker}${(node.children ?? []).map(renderPlainBlock).filter(Boolean).join('\n')}`;
    }
    case 'table':
      return (node.children ?? [])
        .map((row) => (row.children ?? []).map((cell) => renderPlainInline(cell).trim()).join('\t'))
        .join('\n');
    case 'thematicBreak':
      return '——';
    case 'definition':
      return '';
    default:
      return renderPlainInline(node).trim();
  }
}

function visibleArticleRoot(root: MarkdownNode) {
  const children = root.children ?? [];
  const first = children[0];
  return first?.type === 'heading' && first.depth === 1 ? { ...root, children: children.slice(1) } : root;
}

function referencedArticleImages(root: MarkdownNode, article: ArticleDto) {
  const referencedPaths = new Set<string>();
  const remoteImageUrls = new Set<string>();
  visitMarkdown(root, (node) => {
    if (node.type !== 'image' || !node.url) return;
    const normalizedPath = normalizeMediaPath(node.url);
    if (safeHttpsUrl(node.url)) remoteImageUrls.add(node.url);
    else referencedPaths.add(normalizedPath);
  });
  const bindingsByPath = new Map(
    article.content.mediaBindings.map((binding) => [normalizeMediaPath(binding.path), binding]),
  );
  const localImages = [...referencedPaths].map((referencedPath) => {
    const binding = bindingsByPath.get(referencedPath);
    if (!binding) throw new Error('An article image is unavailable for WeChat copy');
    return { referencedPath, binding };
  });
  return { localImages, remoteImageCount: remoteImageUrls.size };
}

export class ArticleWechatCopyService {
  constructor(
    private readonly database: ArticleWechatCopyDatabase,
    private readonly ports: ArticleWechatCopyPorts,
  ) {}

  async copy(input: ArticleCopyForWechatInput): Promise<ArticleCopyForWechatResult> {
    const article = this.database.getArticle(input.id);
    const root = visibleArticleRoot(resolveMarkdownReferences(parseMarkdown(article.content.markdown)));
    const { localImages, remoteImageCount } = referencedArticleImages(root, article);
    const resolvedImages = localImages.map(({ referencedPath, binding }) => {
      const source = this.database.resolveAssetFile(binding.assetId);
      if (!source || !source.mimeType.startsWith('image/')) {
        throw new Error('An article image is unavailable for WeChat copy');
      }
      return { referencedPath, source };
    });

    const imagesByPath = new Map<string, PreparedWechatImage>();
    let mediaBytes = 0;
    for (const { referencedPath, source } of resolvedImages) {
      let bytes: Buffer;
      let mimeType: 'image/png' | 'image/jpeg' | 'image/gif';
      const sourceBytes = await readBoundedImageFile(source.absolutePath);
      if (source.mimeType === 'image/webp' || source.mimeType === 'image/svg+xml') {
        const converted = await (source.mimeType === 'image/webp'
          ? this.ports.convertWebpBytesToPng(sourceBytes)
          : this.ports.convertSvgBytesToPng(sourceBytes));
        if (!converted) throw new Error('An article image could not be prepared for WeChat');
        bytes = converted;
        mimeType = 'image/png';
      } else if (
        source.mimeType === 'image/png' ||
        source.mimeType === 'image/jpeg' ||
        source.mimeType === 'image/gif'
      ) {
        bytes = sourceBytes;
        mimeType = source.mimeType;
      } else {
        throw new Error('An article image is unavailable for WeChat copy');
      }
      mediaBytes += bytes.byteLength;
      if (mediaBytes > MAX_WECHAT_CLIPBOARD_MEDIA_BYTES) {
        throw new Error('The article images are too large to copy to WeChat at once');
      }
      imagesByPath.set(referencedPath, {
        dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
        width: source.width,
        height: source.height,
      });
    }

    const body = renderNode(root, imagesByPath);
    const html = `<section style="${styles.container}">${body}</section>`;
    if (Buffer.byteLength(html, 'utf8') > MAX_WECHAT_CLIPBOARD_HTML_BYTES) {
      throw new Error('The formatted article is too large to copy to WeChat at once');
    }
    const text = renderPlainBlock(root).trim();
    if (!text && imagesByPath.size === 0 && remoteImageCount === 0) throw new Error('The article has no body to copy');
    this.ports.writeClipboard({ html, text });
    return { embeddedImageCount: imagesByPath.size, remoteImageCount };
  }
}
