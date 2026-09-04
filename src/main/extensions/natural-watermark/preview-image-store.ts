import { mkdir, writeFile } from 'node:fs/promises';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { validateCanvasPngAsync, validateDecodablePngAsync } from '@/main/media/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import {
  NATURAL_WATERMARK_PREVIEW_IMAGE_MAX_BYTES,
  NATURAL_WATERMARK_PREVIEW_IMAGE_SIZE,
  naturalWatermarkPreviewImageSchema,
  type NaturalWatermarkPreviewImage,
} from '@/shared/contracts/natural-watermark';

function hasErrorCode(reason: unknown, code: string) {
  return reason instanceof Error && 'code' in reason && Reflect.get(reason, 'code') === code;
}

function bufferView(bytes: Uint8Array<ArrayBufferLike>) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export class NaturalWatermarkPreviewImageStore {
  constructor(
    private readonly filePath: string,
    private readonly directoryPath: string,
  ) {}

  async get(): Promise<NaturalWatermarkPreviewImage | null> {
    let bytes: Buffer;
    try {
      bytes = await readBoundedImageFile(this.filePath);
    } catch (reason) {
      if (hasErrorCode(reason, 'ENOENT')) return null;
      throw reason;
    }
    if (bytes.byteLength > NATURAL_WATERMARK_PREVIEW_IMAGE_MAX_BYTES) {
      throw new Error('Watermark preview image exceeds the file size limit');
    }
    const dimensions = await validateDecodablePngAsync(bytes);
    if (
      !dimensions ||
      dimensions.width > NATURAL_WATERMARK_PREVIEW_IMAGE_SIZE ||
      dimensions.height > NATURAL_WATERMARK_PREVIEW_IMAGE_SIZE
    ) {
      throw new Error('Watermark preview image is invalid');
    }
    return naturalWatermarkPreviewImageSchema.parse({
      mimeType: 'image/png',
      bytes: Uint8Array.from(bytes),
    });
  }

  async importFromFile(sourcePath: string): Promise<NaturalWatermarkPreviewImage> {
    const normalized = await withDecodedImageFileInSandbox(
      sourcePath,
      { operation: 'thumbnail', size: NATURAL_WATERMARK_PREVIEW_IMAGE_SIZE },
      async (result) => {
        if (result.operation !== 'thumbnail') throw new Error('Image decoder returned the wrong operation');
        const bytes = bufferView(result.pngBytes);
        if (bytes.byteLength > NATURAL_WATERMARK_PREVIEW_IMAGE_MAX_BYTES) {
          throw new Error('Watermark preview image exceeds the file size limit');
        }
        const dimensions = await validateCanvasPngAsync(bytes);
        if (!dimensions || dimensions.width !== result.width || dimensions.height !== result.height) {
          throw new Error('Watermark preview image does not match its reported dimensions');
        }
        return bytes;
      },
    );
    await mkdir(this.directoryPath, { recursive: true });
    await writeFile(this.filePath, normalized, { mode: 0o600 });
    const stored = await this.get();
    if (!stored) throw new Error('Watermark preview image was not stored');
    return stored;
  }
}
