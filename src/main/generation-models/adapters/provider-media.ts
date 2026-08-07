import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';

export const MAX_GENERATED_IMAGE_BYTES = 64 * 1024 * 1024;

export type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

function detectedMimeType(bytes: Buffer): SupportedImageMimeType | null {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR' &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.length >= 12 &&
    bytes.subarray(bytes.length - 8, bytes.length - 4).toString('ascii') === 'IEND'
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    return 'image/webp';
  }
  return null;
}

export function validateProviderImage(
  bytes: Buffer,
  expectedMimeTypes: readonly SupportedImageMimeType[] = ['image/png', 'image/jpeg', 'image/webp'],
) {
  if (!bytes.length || bytes.length > MAX_GENERATED_IMAGE_BYTES) {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Provider returned an invalid image payload' });
  }
  const mimeType = detectedMimeType(bytes);
  if (!mimeType || !expectedMimeTypes.includes(mimeType)) {
    throw new GenerationAdapterError({
      code: 'NO_OUTPUT',
      message: 'Provider returned an image whose content does not match the expected format',
    });
  }
  return mimeType;
}

export function readValidatedReferenceImage(filePath: string, declaredMimeType: string, maxBytes: number) {
  const bytes = readFileSync(filePath);
  if (!bytes.length || bytes.length > maxBytes) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: `Reference images must be between 1 byte and ${Math.floor(maxBytes / (1024 * 1024))} MB`,
    });
  }
  let mimeType: SupportedImageMimeType;
  try {
    mimeType = validateProviderImage(bytes);
  } catch (error) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: 'Reference image content is invalid or unsupported',
      cause: error,
    });
  }
  const normalizedDeclaredMimeType = declaredMimeType === 'image/jpg' ? 'image/jpeg' : declaredMimeType;
  if (normalizedDeclaredMimeType && normalizedDeclaredMimeType !== mimeType) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: 'Reference image content does not match its declared format',
    });
  }
  return { bytes, mimeType };
}

export function decodeProviderImageBase64(value: string, expectedMimeTypes?: readonly SupportedImageMimeType[]) {
  const normalized = value.trim();
  const estimatedBytes = Math.floor((normalized.length * 3) / 4);
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    estimatedBytes > MAX_GENERATED_IMAGE_BYTES ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Provider returned invalid base64 image data' });
  }
  const bytes = Buffer.from(normalized, 'base64');
  validateProviderImage(bytes, expectedMimeTypes);
  return bytes;
}

export function writeProviderImage(
  target: string,
  bytes: Buffer,
  expectedMimeTypes?: readonly SupportedImageMimeType[],
) {
  const mimeType = validateProviderImage(bytes, expectedMimeTypes);
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, target);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // No partial provider output remains.
    }
    throw error;
  }
  return mimeType;
}

export async function responseBufferWithinLimit(
  response: Response,
  maxBytes = MAX_GENERATED_IMAGE_BYTES,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Provider image output is too large' });
  }
  if (!response.body) {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Provider returned no image response body' });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Provider image output is too large' });
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    byteLength,
  );
}
