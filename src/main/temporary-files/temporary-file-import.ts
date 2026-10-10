import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { contentMarkdownMediaPaths } from '@/shared/content-markdown';
import { contentAssetPath } from '@/shared/content-asset-path';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { rewriteArticleImageReferences } from '@/main/creations/article-media-references';
import { stageTemporaryImage } from '@/main/temporary-files/temporary-file-images';
import type { TemporaryFilesStore } from '@/main/temporary-files/temporary-files-store';
import { petalError } from '@/shared/petal-errors';

const mimeTypes: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
export async function importTemporaryFile(
  store: TemporaryFilesStore,
  id: string,
  source: string,
  imageEditing = false,
) {
  if (/trash/i.test(source)) throw petalError('sourceUnavailable');
  const resolved = await realpath(source);
  if (/trash/i.test(resolved)) throw petalError('sourceUnavailable');
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = mimeTypes[extension];
  if (imageEditing && mimeType !== 'image/png' && mimeType !== 'image/jpeg') throw petalError('imageEditUnsupported');
  const title = path.basename(source, extension).slice(0, 200);
  const bytes =
    (await stat(resolved)).size === 0
      ? Buffer.alloc(0)
      : await readBoundedImageFile(resolved, undefined, mimeType ? 25 * 1024 * 1024 : 1_000_000);
  const text = mimeType ? '' : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const note = await store.create(id, text, title, mimeType ? undefined : 'markdown', source);
  if (mimeType) {
    const asset = await stageTemporaryImage(store, id, {
      importId: randomUUID(),
      source: 'UPLOAD',
      item: { name: path.basename(source), mimeType, bytes },
    });
    await store.commit(
      { ...store.manifest(id), kind: 'IMAGE', protected: false },
      { note: { ...note, references: [{ assetId: asset.id, mediaUrl: asset.mediaUrl }] }, draft: null },
    );
    return;
  }
  const references = [];
  const destinations = new Map<string, string>();
  const root = path.dirname(resolved);
  for (const mediaPath of contentMarkdownMediaPaths(text)) {
    if (/^(?:https?:|data:|\/\/)/i.test(mediaPath)) continue;
    if (references.length >= 100 || /trash/i.test(mediaPath)) throw petalError('fileLimit');
    const target = await realpath(path.resolve(root, mediaPath));
    const relative = path.relative(root, target);
    if (/trash/i.test(target) || relative.startsWith('..') || path.isAbsolute(relative))
      throw petalError('sourceUnavailable');
    const imageMime = mimeTypes[path.extname(target).toLowerCase()];
    if (!imageMime) throw petalError('sourceUnavailable');
    const image = await stageTemporaryImage(store, id, {
      importId: randomUUID(),
      source: 'UPLOAD',
      item: {
        name: path.basename(target),
        mimeType: imageMime,
        bytes: await readBoundedImageFile(target, undefined, 25 * 1024 * 1024),
      },
    });
    references.push({ assetId: image.id, mediaUrl: image.mediaUrl });
    destinations.set(mediaPath, contentAssetPath(image.id));
  }
  if (references.length)
    await store.commit(store.manifest(id), {
      note: {
        ...note,
        text: rewriteArticleImageReferences(text, destinations, new Map()),
        references,
        contentHash: randomUUID(),
      },
      draft: null,
    });
}
