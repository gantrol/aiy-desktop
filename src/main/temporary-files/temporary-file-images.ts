import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { contentImageStageSchema, type ContentImageStage } from '@/shared/contracts/content-image-import';
import { imageDimensions } from '@/main/media/image-dimensions';
import { createThumbnailInSandbox } from '@/main/media/image-thumbnail-worker-client';
import { rasterizeSvgBytesInSandbox } from '@/main/media/svg-rasterization';
import { petalError } from '@/shared/petal-errors';
import type { TemporaryFilesStore } from '@/main/temporary-files/temporary-files-store';

const extensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
export async function stageTemporaryImage(store: TemporaryFilesStore, owner: string, raw: ContentImageStage) {
  const input = contentImageStageSchema.parse(raw);
  const previous = store.manifest(owner).attachments.find((file) => file.id === input.importId);
  const inputHash = createHash('sha256').update(input.item.bytes).digest('hex');
  if (previous) {
    if (previous.hash !== inputHash) throw petalError('invalidSettings');
    return previous.asset!;
  }
  const raster =
    input.item.mimeType === 'image/svg+xml' ? await rasterizeSvgBytesInSandbox(Buffer.from(input.item.bytes)) : null;
  const bytes = raster?.bytes ?? input.item.bytes;
  const mimeType = raster ? 'image/png' : input.item.mimeType;
  const dimensions = imageDimensions(Buffer.from(bytes), extensions[mimeType]);
  if (!dimensions || dimensions.width * dimensions.height > 100_000_000) throw petalError('invalidSettings');
  const asset = {
    id: input.importId,
    kind: 'REFERENCE' as const,
    ...dimensions,
    mimeType,
    byteSize: bytes.byteLength,
    mediaUrl: `aiy-media://temporary/${owner}/${input.importId}`,
    createdAt: new Date().toISOString(),
  };
  await store.attach(
    owner,
    { id: input.importId, name: input.item.name, mimeType, byteSize: bytes.byteLength, hash: inputHash, asset },
    bytes,
  );
  return asset;
}

/** Cache still representations beside the source; no library or asset registration is involved. */
const posters = new Map<string, Promise<string>>();
export async function temporaryImagePoster(store: TemporaryFilesStore, owner: string, id: string) {
  const key = `${store.root}/${owner}/${id}`;
  const pending = posters.get(key);
  if (pending) return pending;
  const task = store.run(async () => {
    const manifest = store.manifest(owner);
    const original = manifest.attachments.find((item) => item.id === id && item.asset);
    if (!original) throw petalError('sourceUnavailable');
    const cached = manifest.attachments.find((item) => item.name === `poster:${id}`);
    if (cached) return store.file(cached.id, 'bin');
    const posterId = randomUUID();
    const intermediate = path.join(store.root, `${posterId}.pending.png`);
    try {
      await createThumbnailInSandbox(store.file(id, 'bin'), intermediate, 512);
      const bytes = await readFile(intermediate);
      await store.attach(
        owner,
        {
          id: posterId,
          name: `poster:${id}`,
          mimeType: 'image/png',
          byteSize: bytes.byteLength,
          hash: createHash('sha256').update(bytes).digest('hex'),
        },
        bytes,
      );
      return store.file(posterId, 'bin');
    } finally {
      await unlink(intermediate).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  });
  posters.set(key, task);
  void task.finally(() => posters.delete(key)).catch(() => undefined);
  return task;
}
