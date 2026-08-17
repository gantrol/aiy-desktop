import { nativeImage } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { imageDimensions } from '@/main/media/image-dimensions';
import { validateProviderImage, type SupportedImageMimeType } from '@/main/generation-models/adapters/provider-media';

const MAX_COVER_BYTES = 25 * 1024 * 1024;
const MAX_COVER_DIMENSION = 16_384;
const MAX_COVER_PIXELS = 64_000_000;

const extensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
} as const satisfies Record<SupportedImageMimeType, '.png' | '.jpg' | '.webp'>;

export interface PreparedLocalSpaceCover {
  bytes: Buffer;
  extension: (typeof extensionByMimeType)[SupportedImageMimeType];
}

function safeDimensions(width: number, height: number) {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_COVER_DIMENSION &&
    height <= MAX_COVER_DIMENSION &&
    width * height <= MAX_COVER_PIXELS
  );
}

/** Validates a user-selected image before it enters a local-space directory. */
export async function prepareLocalSpaceCover(filePath: string): Promise<PreparedLocalSpaceCover> {
  const source = await stat(filePath);
  if (!source.isFile() || source.size < 1 || source.size > MAX_COVER_BYTES) {
    throw new Error('The selected cover image is unavailable or too large');
  }

  const bytes = await readFile(filePath);
  if (bytes.length < 1 || bytes.length > MAX_COVER_BYTES) {
    throw new Error('The selected cover image is unavailable or too large');
  }

  let mimeType: SupportedImageMimeType;
  try {
    mimeType = validateProviderImage(bytes);
  } catch {
    throw new Error('The selected cover must be a valid PNG, JPEG, or WebP image');
  }

  const extension = extensionByMimeType[mimeType];
  const encodedDimensions = imageDimensions(bytes, extension);
  if (!encodedDimensions || !safeDimensions(encodedDimensions.width, encodedDimensions.height)) {
    throw new Error('The selected cover image has unsupported dimensions');
  }

  const decoded = nativeImage.createFromBuffer(bytes);
  const decodedDimensions = decoded.getSize();
  if (decoded.isEmpty() || !safeDimensions(decodedDimensions.width, decodedDimensions.height)) {
    throw new Error('The selected cover image could not be decoded');
  }

  return { bytes, extension };
}
