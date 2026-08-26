import type { StoredObject } from '@/main/database/core/storage';
import { imageDimensions } from '@/main/media/image-dimensions';

const maxImageHeaderBytes = 4 * 1024 * 1024;

export const extensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
} as const;

export interface StagedMedia {
  stored: StoredObject;
  mimeType: keyof typeof extensionByMimeType;
}

export function hasExpectedMediaSignature(bytes: Uint8Array, mimeType: keyof typeof extensionByMimeType) {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  if (mimeType === 'image/png') {
    return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (mimeType === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    const signature = header.subarray(0, 6).toString('ascii');
    return header.length >= 10 && (signature === 'GIF87a' || signature === 'GIF89a');
  }
  if (mimeType === 'image/webp') {
    return (
      header.length >= 12 &&
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'image/svg+xml') {
    return (
      imageDimensions(
        Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, maxImageHeaderBytes)),
        '.svg',
      ) !== null
    );
  }
  if (mimeType === 'video/webm') {
    return header.length >= 4 && header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  }
  return header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp';
}
