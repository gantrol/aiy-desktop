import { randomUUID } from 'node:crypto';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import {
  imageEditCommandSchema,
  emptyImageEdit,
  IMAGE_EDIT_MAX_EDGE,
  IMAGE_EDIT_MAX_PIXELS,
  type ImageEditSnapshot,
} from '@/shared/contracts/image-edit';
import type { TemporaryFilesStore } from '@/main/temporary-files/temporary-files-store';
import { stageTemporaryImage } from '@/main/temporary-files/temporary-file-images';
import { imageDimensions } from '@/main/media/image-dimensions';
import { petalError } from '@/shared/petal-errors';
import { inspectUploadImage, orientedUploadImageDimensions } from '@/shared/upload-image-policy';

async function snapshot(store: TemporaryFilesStore, id: string): Promise<ImageEditSnapshot> {
  const manifest = store.manifest(id);
  if (manifest.kind !== 'IMAGE' || manifest.promotion) throw petalError('sourceUnavailable');
  const body = await store.body(id);
  const resultAssetId = body.note.references[0]?.assetId;
  const sourceAssetId = body.imageEdit?.sourceAssetId ?? resultAssetId;
  const source = manifest.attachments.find((file) => file.id === sourceAssetId)?.asset;
  // Animated/vector sources need an explicit extraction workflow, not a silently flattened first frame.
  if (!source || !['image/png', 'image/jpeg'].includes(source.mimeType)) throw petalError('invalidSettings');
  let record = body.imageEdit;
  if (!record) {
    const bytes = await readBoundedImageFile(store.file(source.id, 'bin'), undefined, 25 * 1024 * 1024);
    const inspection = inspectUploadImage(bytes, source.mimeType);
    if (inspection.animated) throw petalError('invalidSettings');
    const dimensions = orientedUploadImageDimensions(inspection);
    if (
      dimensions.width > IMAGE_EDIT_MAX_EDGE ||
      dimensions.height > IMAGE_EDIT_MAX_EDGE ||
      dimensions.width * dimensions.height > IMAGE_EDIT_MAX_PIXELS
    )
      throw petalError('invalidSettings');
    record = {
      sourceAssetId,
      resultAssetId,
      revision: body.note.contentHash,
      document: emptyImageEdit(dimensions.width, dimensions.height),
      draft: null,
    };
  }
  return { ...record, sourceUrl: source.mediaUrl, resultAssetId };
}

/** Called inside the store queue and scoped to the sending image window. */
export async function executeTemporaryImageEdit(store: TemporaryFilesStore, id: string, raw: unknown) {
  const input = imageEditCommandSchema.parse(raw);
  const current = await snapshot(store, id);
  if (input.kind === 'load') return current;
  if (current.revision === input.requestId) return current;
  if (current.revision !== input.expectedRevision) throw petalError('unsaved');
  const body = await store.body(id);
  const next = {
    sourceAssetId: current.sourceAssetId,
    resultAssetId: current.resultAssetId,
    revision: input.requestId,
    document: current.document,
    draft: current.draft,
  };
  if ('document' in input) {
    if (input.document.width !== current.document.width || input.document.height !== current.document.height)
      throw petalError('invalidSettings');
    next.draft = input.document;
  }
  if (input.kind === 'cancel') next.draft = null;
  if (input.kind === 'commit') {
    const dimensions = imageDimensions(Buffer.from(input.bytes), '.png');
    const { crop, rotation } = input.document;
    if (
      !dimensions ||
      dimensions.width !== (rotation % 2 ? crop.height : crop.width) ||
      dimensions.height !== (rotation % 2 ? crop.width : crop.height)
    )
      throw petalError('invalidSettings');
    const asset = await stageTemporaryImage(store, id, {
      importId: input.requestId,
      source: 'UPLOAD',
      item: { name: 'Edited.png', mimeType: 'image/png', bytes: input.bytes },
    });
    body.note = {
      ...body.note,
      references: [{ assetId: asset.id, mediaUrl: asset.mediaUrl }],
      contentHash: randomUUID(),
    };
    next.document = input.document;
    next.resultAssetId = asset.id;
    next.draft = null;
  }
  await store.commit({ ...store.manifest(id), protected: true }, { ...body, imageEdit: next });
  if (input.kind === 'commit') {
    // Undo is a document operation on the immutable original; obsolete raster outputs are not history.
    const keep = new Set([next.sourceAssetId, next.resultAssetId]);
    await store
      .pruneAttachments(id, (file) => keep.has(file.id) || [...keep].some((asset) => file.name === `poster:${asset}`))
      .catch((error) => console.error('[temporary-files] obsolete image cleanup deferred', error));
  }
  return snapshot(store, id);
}
