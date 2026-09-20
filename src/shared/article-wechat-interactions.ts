import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { contentAssetPath } from '@/shared/content-document';
import type { ArticleWechatImageSource } from '@/shared/article-wechat-renderer';
import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';

const SVG_WIDTH = 375;
const SVG_PADDING = 16;
const SVG_TEXT_WIDTH = SVG_WIDTH - SVG_PADDING * 2;
const SVG_LINE_HEIGHT = 30;
const SVG_FONT_SIZE = 16;
const SVG_MAX_HEIGHT = 8_000;

export interface ArticleWechatInteraction {
  marker: string;
  node: BlockNode;
}

export interface ArticleWechatInteractionProjection {
  markdown: string;
  interactions: ArticleWechatInteraction[];
}

/** Preserve the editable document while replacing top-level interactions in its WeChat projection. */
export function articleWechatInteractionProjection(
  document: BlockDocument | undefined,
  media: readonly { path: string; assetId: string }[],
): ArticleWechatInteractionProjection | null {
  if (!document?.root.content?.some((node) => node.type === 'details' || node.type === 'reveal')) return null;
  const nonce = globalThis.crypto.randomUUID().replaceAll('-', '').toUpperCase();
  const interactions: ArticleWechatInteraction[] = [];
  const content = document.root.content.map((node) => {
    if (node.type !== 'details' && node.type !== 'reveal') return node;
    const marker = `AIY_INTERACTION_${nonce}_${interactions.length}_END`;
    interactions.push({ marker, node });
    return { type: 'paragraph', content: [{ type: 'text', text: marker }] };
  });
  return {
    markdown: blockDocumentMarkdown({ ...document, root: { ...document.root, content } }, media),
    interactions,
  };
}

type DrawItem = { kind: 'text'; value: string } | { kind: 'image'; source: ArticleWechatImageSource };

function imagePath(node: BlockNode, media: readonly { path: string; assetId: string }[]) {
  const attrs = node.attrs ?? {};
  if (typeof attrs.mediaPath === 'string') return attrs.mediaPath;
  if (typeof attrs.sourcePath === 'string') return attrs.sourcePath;
  if (typeof attrs.assetId === 'string')
    return media.find((binding) => binding.assetId === attrs.assetId)?.path ?? contentAssetPath(attrs.assetId);
  return typeof attrs.src === 'string' ? attrs.src : '';
}

function safeImageSource(value: string) {
  return (
    /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/u.test(value) ||
    /^aiy-handoff-media:\d+$/u.test(value) ||
    /^aiy-media:\/\/asset\/[A-Za-z0-9%._-]+$/u.test(value) ||
    /^https:\/\//u.test(value)
  );
}

function drawItems(
  nodes: readonly BlockNode[],
  media: readonly { path: string; assetId: string }[],
  images: ReadonlyMap<string, ArticleWechatImageSource>,
): DrawItem[] | null {
  const result: DrawItem[] = [];
  for (const node of nodes) {
    if (node.type === 'image') {
      const source = images.get(imagePath(node, media));
      if (!source || !safeImageSource(source.src) || source.width <= 0 || source.height <= 0) return null;
      result.push({ kind: 'image', source });
      continue;
    }
    if (node.type !== 'paragraph' && node.type !== 'heading') return null;
    let value = '';
    for (const child of node.content ?? []) {
      if (child.type !== 'text' && child.type !== 'hardBreak') return null;
      if (child.marks?.some((mark) => mark.type === 'link')) return null;
      value += child.type === 'hardBreak' ? '\n' : (child.text ?? '');
    }
    if (value.length > 3_000) return null;
    result.push({ kind: 'text', value });
  }
  return result.length <= 40 ? result : null;
}

function escapeXml(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

function characterWidth(character: string) {
  return /^[\u0000-\u007f]$/u.test(character) ? (character === ' ' ? 5 : 9) : 16;
}

function wrapText(value: string) {
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    let width = 0;
    for (const character of paragraph) {
      const nextWidth = characterWidth(character);
      if (line && width + nextWidth > SVG_TEXT_WIDTH) {
        lines.push(line);
        line = '';
        width = 0;
      }
      line += character;
      width += nextWidth;
    }
    lines.push(line);
  }
  return lines;
}

function drawStage(items: readonly DrawItem[]) {
  let y = SVG_PADDING;
  const elements: string[] = [];
  for (const item of items) {
    if (item.kind === 'text') {
      for (const line of wrapText(item.value)) {
        y += SVG_LINE_HEIGHT;
        if (line)
          elements.push(
            `<text x="${SVG_PADDING}" y="${y}" font-size="${SVG_FONT_SIZE}" fill="#302b29" font-family="sans-serif">${escapeXml(line)}</text>`,
          );
      }
      y += 8;
      continue;
    }
    const height = Math.round((SVG_TEXT_WIDTH * item.source.height) / item.source.width);
    if (height < 1 || height > 4_000) return null;
    const href = escapeXml(item.source.src);
    elements.push(
      `<image x="${SVG_PADDING}" y="${y}" width="${SVG_TEXT_WIDTH}" height="${height}" href="${href}" xlink:href="${href}" preserveAspectRatio="xMidYMid meet"></image>`,
    );
    y += height + 12;
  }
  return { height: Math.max(56, y + SVG_PADDING), html: elements.join('') };
}

/** A deliberately small, script-free SVG subset. Rich blocks retain the static article projection. */
export function renderArticleWechatInteractionSvg(
  interaction: ArticleWechatInteraction,
  media: readonly { path: string; assetId: string }[],
  images: ReadonlyMap<string, ArticleWechatImageSource>,
) {
  const { node } = interaction;
  const [first, second] = node.content ?? [];
  const initialNodes =
    node.type === 'details' ? [{ type: 'paragraph', content: first?.content ?? [] }] : (first?.content ?? []);
  const revealedNodes =
    node.type === 'details' ? [...initialNodes, ...(second?.content ?? [])] : (second?.content ?? []);
  const initialItems = drawItems(initialNodes, media, images);
  const revealedItems = drawItems(revealedNodes, media, images);
  if (!initialItems || !revealedItems) return null;
  if (node.type === 'reveal' && node.attrs?.kind === 'IMAGE_SWAP') {
    if (
      initialItems.filter((item) => item.kind === 'image').length !== 1 ||
      revealedItems.filter((item) => item.kind === 'image').length !== 1
    )
      return null;
  }
  const initial = drawStage(initialItems);
  const revealed = drawStage(revealedItems);
  if (!initial || !revealed) return null;
  const fullHeight = Math.max(initial.height, revealed.height);
  if (fullHeight > SVG_MAX_HEIGHT) return null;
  const startingHeight = node.type === 'details' ? initial.height : fullHeight;
  const svgId = interaction.marker.toLowerCase();
  const trigger = `${svgId}.click`;
  const heightAnimation =
    startingHeight === fullHeight
      ? ''
      : `<animate attributeName="height" from="${startingHeight}" to="${fullHeight}" begin="${trigger}" dur="0.25s" fill="freeze" restart="never"></animate><animate attributeName="viewBox" from="0 0 ${SVG_WIDTH} ${startingHeight}" to="0 0 ${SVG_WIDTH} ${fullHeight}" begin="${trigger}" dur="0.25s" fill="freeze" restart="never"></animate>`;
  return `<svg id="${svgId}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100%" height="${startingHeight}" viewBox="0 0 ${SVG_WIDTH} ${startingHeight}" preserveAspectRatio="xMinYMin meet" style="display:block;max-width:${SVG_WIDTH}px;margin:1em auto;overflow:hidden;cursor:pointer" data-aiy-interaction="${node.type}"><g opacity="1"><rect width="${SVG_WIDTH}" height="${fullHeight}" fill="#ffffff"></rect>${initial.html}<animate attributeName="opacity" from="1" to="0" begin="${trigger}" dur="0.2s" fill="freeze" restart="never"></animate></g><g opacity="0"><rect width="${SVG_WIDTH}" height="${fullHeight}" fill="#ffffff"></rect>${revealed.html}<animate attributeName="opacity" from="0" to="1" begin="${trigger}" dur="0.2s" fill="freeze" restart="never"></animate></g><rect width="${SVG_WIDTH}" height="${startingHeight}" fill="#ffffff" opacity="0" style="pointer-events:all"></rect>${heightAnimation}</svg>`;
}
