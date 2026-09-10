import { unified, type Plugin } from 'unified';
import * as remarkGfmModule from 'remark-gfm';
import * as remarkParseModule from 'remark-parse';

interface MarkdownNode {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
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

function visitMarkdown(node: MarkdownNode, visitor: (candidate: MarkdownNode) => void) {
  visitor(node);
  for (const child of node.children ?? []) visitMarkdown(child, visitor);
}

export function normalizedArticleMediaPath(value: string) {
  const mediaPath = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(mediaPath);
  } catch {
    return mediaPath;
  }
}

function internalAssetId(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'aiy-media:') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'asset' || segments.length !== 1 || url.username || url.password || url.port) {
    throw new Error('An article image reference is unavailable');
  }
  try {
    return decodeURIComponent(segments[0]!);
  } catch {
    throw new Error('An article image reference is unavailable');
  }
}

function articleImageNodes(markdown: string) {
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MarkdownNode;
  const images: MarkdownNode[] = [];
  const definitions = new Map<string, MarkdownNode>();
  const references = new Set<string>();
  visitMarkdown(root, (node) => {
    if (node.type === 'image') images.push(node);
    if (node.type === 'definition' && node.identifier && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
    if (node.type === 'imageReference' && node.identifier) references.add(node.identifier);
  });
  for (const identifier of references) {
    const definition = definitions.get(identifier);
    if (definition) images.push(definition);
  }
  return images;
}

/** Only the selected revision's body and cover belong in a delivery snapshot. */
export function referencedArticleMediaBindings(
  markdown: string,
  bindings: readonly { path: string; assetId: string }[],
  coverAssetId: string | null,
) {
  const paths = new Set<string>();
  const assetIds = new Set<string>(coverAssetId ? [coverAssetId] : []);
  for (const node of articleImageNodes(markdown)) {
    if (!node.url) continue;
    const assetId = internalAssetId(node.url);
    if (assetId) assetIds.add(assetId);
    else paths.add(normalizedArticleMediaPath(node.url));
  }
  const selected = bindings.filter((binding) => paths.has(normalizedArticleMediaPath(binding.path)));
  const selectedIds = new Set(selected.map((binding) => binding.assetId));
  for (const assetId of assetIds) {
    if (!selectedIds.has(assetId)) selected.push({ path: `aiy-media://asset/${encodeURIComponent(assetId)}`, assetId });
  }
  const boundPaths = new Set(selected.map((binding) => normalizedArticleMediaPath(binding.path)));
  for (const mediaPath of paths) {
    if (!boundPaths.has(mediaPath) && !/^(?:https?:|data:|\/media\/)/iu.test(mediaPath)) {
      throw Object.assign(new Error(mediaPath), { code: 'DELIVERY_MEDIA_UNBOUND' });
    }
  }
  return selected;
}

export function rewriteArticleImageReferences(
  markdown: string,
  destinationsByPath: ReadonlyMap<string, string>,
  destinationsByAssetId: ReadonlyMap<string, string>,
) {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const node of articleImageNodes(markdown)) {
    if (!node.url) continue;
    const assetId = internalAssetId(node.url);
    const destination = assetId
      ? destinationsByAssetId.get(assetId)
      : destinationsByPath.get(normalizedArticleMediaPath(node.url));
    if (!destination) {
      if (assetId || node.url.startsWith('aiy-media:')) throw new Error('An article image reference is unavailable');
      continue;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < 0 || end > markdown.length || start >= end) {
      throw new Error('An article image reference could not be rewritten');
    }
    const source = markdown.slice(start, end);
    const destinationStart = source.indexOf('](');
    const relativeUrlOffset = source.indexOf(node.url, destinationStart < 0 ? 0 : destinationStart + 2);
    if (relativeUrlOffset < 0) throw new Error('An article image reference could not be rewritten');
    replacements.push({
      start: start + relativeUrlOffset,
      end: start + relativeUrlOffset + node.url.length,
      value: destination,
    });
  }
  let rewritten = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
  }
  return rewritten;
}
