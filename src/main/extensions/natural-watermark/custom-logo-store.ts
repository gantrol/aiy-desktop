import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import {
  NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES,
  NATURAL_WATERMARK_CUSTOM_LOGO_SIZE,
  naturalWatermarkCustomLogoIdSchema,
  naturalWatermarkCustomLogoSchema,
  type NaturalWatermarkCustomLogo,
} from '@/shared/contracts/natural-watermark';

function hasErrorCode(reason: unknown, code: string) {
  return reason instanceof Error && 'code' in reason && Reflect.get(reason, 'code') === code;
}

function contentId(bytes: Uint8Array<ArrayBufferLike>) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bufferView(bytes: Uint8Array<ArrayBufferLike>) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export class NaturalWatermarkCustomLogoStore {
  constructor(private readonly directoryPath: string) {}

  private filePath(rawId: string) {
    return path.join(this.directoryPath, `${naturalWatermarkCustomLogoIdSchema.parse(rawId)}.png`);
  }

  async get(rawId: string): Promise<NaturalWatermarkCustomLogo> {
    const id = naturalWatermarkCustomLogoIdSchema.parse(rawId);
    const bytes = await readBoundedImageFile(this.filePath(id));
    if (bytes.byteLength > NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES || contentId(bytes) !== id) {
      throw new Error('Custom watermark logo does not match its immutable identity');
    }
    const dimensions = await validateCanvasPngAsync(bytes);
    if (
      !dimensions ||
      dimensions.width > NATURAL_WATERMARK_CUSTOM_LOGO_SIZE ||
      dimensions.height > NATURAL_WATERMARK_CUSTOM_LOGO_SIZE
    ) {
      throw new Error('Custom watermark logo exceeds the dimension limit');
    }
    return naturalWatermarkCustomLogoSchema.parse({
      id,
      mimeType: 'image/png',
      bytes: Uint8Array.from(bytes),
    });
  }

  async importFromFile(filePath: string): Promise<NaturalWatermarkCustomLogo> {
    const normalized = await withDecodedImageFileInSandbox(
      filePath,
      { operation: 'thumbnail', size: NATURAL_WATERMARK_CUSTOM_LOGO_SIZE },
      async (result) => {
        if (result.operation !== 'thumbnail') throw new Error('Image decoder returned the wrong operation');
        const bytes = bufferView(result.pngBytes);
        if (bytes.byteLength > NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES) {
          throw new Error('Custom watermark logo exceeds the file size limit');
        }
        const dimensions = await validateCanvasPngAsync(bytes);
        if (!dimensions || dimensions.width !== result.width || dimensions.height !== result.height) {
          throw new Error('Custom watermark logo does not match its reported dimensions');
        }
        return bytes;
      },
    );
    const id = contentId(normalized);
    await mkdir(this.directoryPath, { recursive: true });
    try {
      await writeFile(this.filePath(id), normalized, { flag: 'wx', mode: 0o600 });
    } catch (reason) {
      if (!hasErrorCode(reason, 'EEXIST')) throw reason;
      const existing = await readBoundedImageFile(this.filePath(id));
      if (!existing.equals(normalized)) throw new Error('Custom watermark logo identity collision');
    }
    return this.get(id);
  }
}
