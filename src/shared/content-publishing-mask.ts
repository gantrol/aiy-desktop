import type { PhrasingContent, RootContent } from 'mdast';
import { contentAssetPath, normalizeContentMediaPath } from '@/shared/content-asset-path';
import { contentFigureReferenceAssetId } from '@/shared/content-figure-reference';
import { contentMarkdownTree } from '@/shared/content-markdown';
export { contentFigureReferenceUrl, contentFigureReferenceAssetId } from '@/shared/content-figure-reference';

type MarkdownNode = RootContent | PhrasingContent;
export type ContentPublishingMask = 'numbered-gallery' | 'inline-article';

function visit(node: MarkdownNode, visitor: (node: MarkdownNode) => void) {
  visitor(node);
  if ('children' in node) node.children.forEach((child) => visit(child as MarkdownNode, visitor));
}

function markdownContext(markdown: string) {
  const tree = contentMarkdownTree(markdown);
  const definitions = new Map<string, string>();
  tree.children.forEach((node) =>
    visit(node, (candidate) => {
      if (candidate.type === 'definition' && !definitions.has(candidate.identifier.toLowerCase()))
        definitions.set(candidate.identifier.toLowerCase(), candidate.url);
    }),
  );
  const url = (node: MarkdownNode) => {
    if (node.type === 'image' || node.type === 'link') return node.url;
    if (node.type === 'imageReference' || node.type === 'linkReference')
      return definitions.get(node.identifier.toLowerCase()) ?? '';
    return '';
  };
  return { tree, url };
}

export function contentFigureReferences(markdown: string) {
  const { tree, url } = markdownContext(markdown);
  const references: { url: string; assetId: string | null }[] = [];
  tree.children.forEach((node) =>
    visit(node, (candidate) => {
      if (candidate.type !== 'link' && candidate.type !== 'linkReference') return;
      const destination = url(candidate);
      if (/^aiy-figure:/iu.test(destination))
        references.push({
          url: destination,
          assetId: contentFigureReferenceAssetId(destination),
        });
    }),
  );
  return references;
}

export function contentPublishingMediaBindings(
  mediaAssetIds: readonly string[],
  mediaBindings: readonly { path: string; assetId: string }[],
) {
  const bindings = new Map<string, string>();
  const bind = (path: string, id: string) => {
    bindings.set(path, id);
    bindings.set(normalizeContentMediaPath(path), id);
  };
  mediaBindings.forEach(({ path, assetId }) => bind(path, assetId));
  for (const id of new Set([...mediaAssetIds, ...mediaBindings.map((binding) => binding.assetId)])) {
    bind(contentAssetPath(id), id);
    bind(`aiy-media://asset/${encodeURIComponent(id)}`, id);
  }
  return {
    assetId: (path: string) => bindings.get(path) ?? bindings.get(normalizeContentMediaPath(path)),
    knownAssetIds: new Set(bindings.values()),
  };
}

interface GalleryProjectionInput {
  markdown: string;
  leadingMediaAssetIds?: readonly string[];
  mediaAssetIds: readonly string[];
  mediaBindings: readonly { path: string; assetId: string }[];
  imageLabel(position: number): string;
  numbering: string;
}

interface GalleryRenderContext {
  url(node: MarkdownNode): string;
  imageAssetId(node: MarkdownNode): string | undefined;
  imageLabel(assetId: string): string;
  group(assetIds: readonly string[]): string;
}

function isImage(node: MarkdownNode) {
  return node.type === 'image' || node.type === 'imageReference';
}

function imageOnlyParagraph(node: MarkdownNode) {
  if (node.type !== 'paragraph') return false;
  const meaningful = node.children.filter(
    (child) => child.type !== 'break' && (child.type !== 'text' || child.value.trim()),
  );
  return meaningful.length > 0 && meaningful.every(isImage);
}

function mentionedAssets(node: MarkdownNode, context: GalleryRenderContext) {
  const ids = new Set<string>();
  visit(node, (child) => {
    const id = isImage(child) ? context.imageAssetId(child) : contentFigureReferenceAssetId(context.url(child));
    if (id) ids.add(id);
  });
  return ids;
}

function renderGalleryInline(node: MarkdownNode, context: GalleryRenderContext): string {
  if (isImage(node)) {
    const id = context.imageAssetId(node);
    return id ? context.group([id]) : '';
  }
  if (node.type === 'link' || node.type === 'linkReference') {
    const id = contentFigureReferenceAssetId(context.url(node));
    if (id) return context.imageLabel(id);
  }
  if (node.type === 'break') return '\n';
  if (node.type === 'definition' || node.type === 'html') return '';
  if ('value' in node) return node.value;
  return 'children' in node
    ? node.children.map((child) => renderGalleryInline(child as MarkdownNode, context)).join('')
    : '';
}

function renderGalleryBlock(node: MarkdownNode, context: GalleryRenderContext): string {
  if (node.type === 'list')
    return node.children
      .map((item, index) => {
        const marker = node.ordered ? `${(node.start ?? 1) + index}.` : '•';
        const checked = item.checked === null || item.checked === undefined ? '' : item.checked ? '☑ ' : '☐ ';
        const text = item.children
          .map((child) => renderGalleryBlock(child, context))
          .filter(Boolean)
          .join('\n');
        return `${marker} ${checked}${text.replace(/\n/gu, '\n  ')}`;
      })
      .join('\n');
  if (node.type === 'blockquote')
    return node.children
      .map((child) => renderGalleryBlock(child, context))
      .filter(Boolean)
      .join('\n\n')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  if (node.type === 'table')
    return node.children
      .map((row) => row.children.map((cell) => renderGalleryInline(cell, context)).join(' | '))
      .join('\n');
  if (node.type === 'thematicBreak') return '——';
  return renderGalleryInline(node, context).trim();
}

function appendReference(text: string, reference: string, numbering: string) {
  const punctuation = /([。！？.!?]+)$/u.exec(text)?.[0] ?? '';
  const body = punctuation ? text.slice(0, -punctuation.length) : text;
  return `${body}${numbering === 'chinese' ? '' : ' '}${reference}${punctuation}`;
}

function renderGalleryBlocks(nodes: readonly RootContent[], context: GalleryRenderContext, numbering: string) {
  const blocks: { text: string; paragraph: boolean; mentions: Set<string> }[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.type === 'definition') continue;
    if (imageOnlyParagraph(node)) {
      const ids = new Set<string>();
      for (; index < nodes.length && imageOnlyParagraph(nodes[index]!); index++)
        mentionedAssets(nodes[index]!, context).forEach((id) => ids.add(id));
      index--;
      const previous = blocks.at(-1);
      const remaining = [...ids].filter((id) => !previous?.paragraph || !previous.mentions.has(id));
      if (!remaining.length) continue;
      const reference = context.group(remaining);
      if (previous?.paragraph) {
        previous.text = appendReference(previous.text, reference, numbering);
        remaining.forEach((id) => previous.mentions.add(id));
      } else {
        blocks.push({ text: reference, paragraph: false, mentions: ids });
      }
      continue;
    }
    const text = renderGalleryBlock(node, context);
    // Even an unsupported/empty block is a boundary; never move a figure across it.
    blocks.push({
      text,
      paragraph: node.type === 'paragraph' && Boolean(text),
      mentions: mentionedAssets(node, context),
    });
  }
  return blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/** Project prose + image placements to a channel's separate, ordered attachment gallery. */
export function projectNumberedGallery({
  markdown,
  leadingMediaAssetIds = [],
  mediaAssetIds,
  mediaBindings,
  imageLabel,
  numbering,
}: GalleryProjectionInput) {
  const { tree, url } = markdownContext(markdown);
  const orderedIds = [...new Set([...leadingMediaAssetIds, ...mediaAssetIds])];
  const media = contentPublishingMediaBindings(orderedIds, mediaBindings);
  const missingImages = new Set<string>();
  const imageAssetId = (node: MarkdownNode) => media.assetId(url(node));
  const references: { url: string; assetId: string | null }[] = [];
  tree.children.forEach((node) =>
    visit(node, (child) => {
      if (isImage(child)) {
        const id = imageAssetId(child);
        if (!id) missingImages.add(url(child));
        else if (!orderedIds.includes(id)) orderedIds.push(id);
      }
      if ((child.type === 'link' || child.type === 'linkReference') && /^aiy-figure:/iu.test(url(child)))
        references.push({
          url: url(child),
          assetId: contentFigureReferenceAssetId(url(child)),
        });
    }),
  );
  // Forward references must not reorder the images they refer to.
  references.forEach(({ url: destination, assetId }) => {
    if (!assetId || !media.knownAssetIds.has(assetId)) missingImages.add(destination);
    else if (!orderedIds.includes(assetId)) orderedIds.push(assetId);
  });
  const labels = new Map(orderedIds.map((id, index) => [id, imageLabel(index + 1)]));
  const context: GalleryRenderContext = {
    url,
    imageAssetId,
    imageLabel: (id) => labels.get(id) ?? '',
    group: (ids) => {
      const text = [...new Set(ids)]
        .map((id) => labels.get(id))
        .filter(Boolean)
        .join(numbering === 'chinese' ? '、' : ', ');
      return numbering === 'chinese' ? `（${text}）` : `(${text})`;
    },
  };
  return {
    mask: 'numbered-gallery' as const,
    text: renderGalleryBlocks(tree.children, context, numbering),
    mediaAssetIds: orderedIds,
    missingImages: [...missingImages],
  };
}
