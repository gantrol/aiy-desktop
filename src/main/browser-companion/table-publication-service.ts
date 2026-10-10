import sharp from 'sharp';
import { publicationTables } from '@/shared/publication-tables';
import { contentAssetPath } from '@/shared/content-asset-path';
import { projectNumberedGallery } from '@/shared/content-publishing-mask';
import { tablePublicationOrder } from '@/shared/table-publication-order';
import { XIAOHONGSHU_IMAGE_MAX_BYTES, XIAOHONGSHU_IMAGE_TYPES } from '@/shared/xiaohongshu-publishing';
import {
  BROWSER_COMPANION_MAX_MEDIA_BYTES,
  browserCompanionMediaMimeTypeSchema,
} from '@/main/browser-companion/protocol';
import {
  tablePublicationInputSchema,
  type TablePublicationInput,
  type TablePublicationResult,
} from '@/shared/contracts/table-publication';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { selectedWatermarkProfile, type NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import { renderTableImages } from '@/main/browser-companion/table-image-renderer';
import { tableImageHtml } from '@/main/browser-companion/table-image-html';
import { saveTablePublication, type TablePublicationFile } from '@/main/browser-companion/table-publication-cache';

const MAX_BYTES = 48 * 1024 * 1024;
let active: { requestId: string; spaceId: string; controller: AbortController } | null = null;
const cancelled = new Map<string, number>();

function assertPublicationFile(file: TablePublicationFile, target: TablePublicationInput['target']) {
  if (
    !browserCompanionMediaMimeTypeSchema.safeParse(file.mimeType).success ||
    file.bytes.byteLength > BROWSER_COMPANION_MAX_MEDIA_BYTES
  )
    throw new Error('TABLE_RESOURCE_UNAVAILABLE');
  if (target === 'xiaohongshu') {
    if (!XIAOHONGSHU_IMAGE_TYPES.some((type) => type === file.mimeType))
      throw new Error('XIAOHONGSHU_MEDIA_UNSUPPORTED');
    if (file.bytes.byteLength > XIAOHONGSHU_IMAGE_MAX_BYTES) throw new Error('XIAOHONGSHU_MEDIA_TOO_LARGE');
  }
  if (target === 'x') {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) throw new Error('X_MEDIA_UNSUPPORTED');
    if (file.bytes.byteLength > 5 * 1024 * 1024) throw new Error('X_MEDIA_TOO_LARGE');
  }
}

export function cancelTablePublication(ids: readonly string[], spaceId: string) {
  for (const [key, until] of cancelled) if (until < Date.now()) cancelled.delete(key);
  for (const id of ids) cancelled.set(`${spaceId}:${id}`, Date.now() + 120_000);
  while (cancelled.size > 256) cancelled.delete(cancelled.keys().next().value!);
  if (active?.spaceId === spaceId && ids.includes(active.requestId))
    active.controller.abort(new Error('TABLE_RENDER_FAILED'));
}

export async function prepareTablePublication(
  raw: TablePublicationInput,
  resolve: (id: string) => ResolvedAssetFile | null,
  watermark?: NaturalWatermarkRuntime,
) {
  if (active) throw new Error('TABLE_PREPARATION_BUSY');
  const input = tablePublicationInputSchema.parse(raw);
  if (cancelled.delete(`${input.expectedSpaceId}:${input.requestId}`)) throw new Error('TABLE_RENDER_FAILED');
  const controller = new AbortController();
  active = { requestId: input.requestId, spaceId: input.expectedSpaceId, controller };
  const timer = setTimeout(() => controller.abort(new Error('TABLE_RENDER_FAILED')), 90_000);
  try {
    return await prepare(input, resolve, watermark, controller.signal);
  } finally {
    active = null;
    clearTimeout(timer);
  }
}

async function prepare(
  input: TablePublicationInput,
  resolve: (id: string) => ResolvedAssetFile | null,
  watermark: NaturalWatermarkRuntime | undefined,
  signal: AbortSignal,
) {
  const tables = publicationTables(input.markdown);
  if (!tables.length || tables.length > 20) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
  const id = input.requestId;
  const maximum = input.target === 'x' || input.target === 'wechat' ? 20 : 18;
  const sourceFiles = new Map<string, TablePublicationFile>();
  let usedBytes = 0;
  function charge(bytes: Buffer) {
    usedBytes += bytes.byteLength;
    if (usedBytes > MAX_BYTES) throw new Error('TABLE_IMAGE_LIMIT');
  }
  async function source(assetId: string) {
    const previous = sourceFiles.get(assetId);
    if (previous) return previous;
    const asset = resolve(assetId);
    if (!asset || !asset.mimeType.startsWith('image/')) throw new Error('TABLE_RESOURCE_UNAVAILABLE');
    const bytes = await readBoundedImageFile(
      asset.absolutePath,
      signal,
      Math.min(32 * 1024 * 1024, MAX_BYTES - usedBytes),
    );
    charge(bytes);
    const file = { bytes, mimeType: asset.mimeType, suggestedName: asset.suggestedName };
    sourceFiles.set(assetId, file);
    return file;
  }
  const inlineImages = new Map<string, string>();
  async function inlineImage(assetId: string) {
    const previous = inlineImages.get(assetId);
    if (previous) return previous;
    const file = await source(assetId);
    const metadata = await sharp(file.bytes, { limitInputPixels: 16_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1)
      throw new Error('TABLE_RESOURCE_UNAVAILABLE');
    const png = await sharp(file.bytes, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize({ width: 1000, height: 480, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    charge(png);
    const url = `data:image/png;base64,${png.toString('base64')}`;
    inlineImages.set(assetId, url);
    return url;
  }
  const profile = await selectedWatermarkProfile(input.watermark, watermark);
  const files = new Map<string, TablePublicationFile>();
  const groups: TablePublicationResult['preview']['tables'] = [];
  const replacements: { start: number; end: number; markdown: string }[] = [];
  const bindings = [...input.mediaBindings];
  let linksAsText = false;
  let generated = 0;
  for (const [number, table] of tables.entries()) {
    signal.throwIfAborted();
    const start = table.position?.start.offset,
      end = table.position?.end.offset;
    if (start === undefined || end === undefined) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    const label = input.tableLabel.replace('{number}', String(number + 1));
    const html = await tableImageHtml(table, input, inlineImage);
    linksAsText ||= html.linksAsText;
    const images = await renderTableImages(html.rows, label, maximum - generated, signal);
    const mediaAssetIds: string[] = [];
    for (const [page, original] of images.entries()) {
      signal.throwIfAborted();
      const assetId = `table-${id}-${number + 1}-${page + 1}`;
      let bytes = original;
      // Keep the selected watermark in a separate margin so it cannot cover table data.
      if (profile && watermark) {
        const margin = await sharp({ create: { width: 1200, height: 180, channels: 4, background: '#fff' } })
          .png()
          .toBuffer();
        const stamped = await watermark.service.applyBytes(margin, 'image/png', 'table.png', profile, signal);
        bytes = await sharp(original)
          .extend({ bottom: 180, background: '#fff' })
          .composite([{ input: stamped.bytes, gravity: 'south' }])
          .png()
          .toBuffer();
      }
      if (bytes.byteLength > (input.target === 'x' ? 5 : 25) * 1024 * 1024) throw new Error('TABLE_IMAGE_LIMIT');
      charge(bytes);
      files.set(assetId, { bytes, mimeType: 'image/png', suggestedName: `table-${number + 1}-${page + 1}.png` });
      mediaAssetIds.push(assetId);
      bindings.push({ path: contentAssetPath(assetId), assetId });
    }
    generated += mediaAssetIds.length;
    groups.push({ number: number + 1, markdown: input.markdown.slice(start, end), mediaAssetIds });
    replacements.push({
      start,
      end,
      markdown: `${label}\n\n${mediaAssetIds.map((assetId) => `![](${contentAssetPath(assetId)})`).join('\n\n')}`,
    });
  }
  let markdown = input.markdown;
  for (const replacement of replacements.reverse())
    markdown = markdown.slice(0, replacement.start) + replacement.markdown + markdown.slice(replacement.end);
  const natural = projectNumberedGallery({
    markdown,
    leadingMediaAssetIds: input.leadingMediaAssetIds,
    mediaAssetIds: [],
    mediaBindings: bindings,
    numbering: 'decimal',
    imageLabel: String,
  });
  if (natural.missingImages.length) throw new Error('TABLE_RESOURCE_UNAVAILABLE');
  // Images absorbed by a table are not emitted again unless explicitly selected as gallery attachments.
  const order = [...new Set([...natural.mediaAssetIds, ...input.mediaAssetIds])];
  const mediaAssetIds = tablePublicationOrder(
    order,
    input.preferredMediaAssetIds,
    groups.map((group) => group.mediaAssetIds),
  );
  if (mediaAssetIds.length > maximum) throw new Error('TABLE_IMAGE_LIMIT');
  if (input.leadingMediaAssetIds[0] && mediaAssetIds[0] !== input.leadingMediaAssetIds[0])
    throw new Error('TABLE_ORDER_CONFLICT');
  for (const assetId of mediaAssetIds) {
    if (files.has(assetId)) continue;
    const original = await source(assetId);
    const file =
      profile && watermark
        ? await watermark.service.applyBytes(original.bytes, original.mimeType, original.suggestedName, profile, signal)
        : original;
    if (file !== original) charge(file.bytes);
    assertPublicationFile(file, input.target);
    files.set(assetId, file);
  }
  signal.throwIfAborted();
  const result: TablePublicationResult = {
    markdown,
    mediaAssetIds,
    mediaBindings: bindings,
    preview: {
      id,
      markdown,
      mediaBindings: bindings,
      coverAssetId: input.leadingMediaAssetIds[0] ?? null,
      tables: groups,
      linksAsText,
      media: mediaAssetIds.map((assetId) => ({ assetId, mediaUrl: `aiy-media://publication/${id}/${assetId}` })),
    },
  };
  saveTablePublication(input, result, files);
  return result;
}
