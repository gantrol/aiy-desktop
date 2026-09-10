import { imageDimensions } from '@/main/media/image-dimensions';
import { GIF_MAX_SOURCE_PIXELS } from '@/shared/contracts/gif-making';

/** Reject animated PNG/WebP instead of silently normalizing them to their first frame. */
export function gifSourceInfo(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let extension: '.png' | '.jpg' | '.webp';
  let mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    extension = '.png';
    mimeType = 'image/png';
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      if (offset + length + 12 > buffer.length) throw new Error('GIF_INVALID');
      const chunk = buffer.toString('ascii', offset + 4, offset + 8);
      if (chunk === 'acTL') throw new Error('GIF_ANIMATED_SOURCE');
      offset += length + 12;
      if (chunk === 'IEND') break;
    }
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    extension = '.jpg';
    mimeType = 'image/jpeg';
  } else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    extension = '.webp';
    mimeType = 'image/webp';
    for (let offset = 12; offset + 8 <= buffer.length;) {
      const chunk = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (offset + size + 8 > buffer.length) throw new Error('GIF_INVALID');
      if (chunk === 'ANIM' || chunk === 'ANMF' || (chunk === 'VP8X' && buffer[offset + 8] & 2))
        throw new Error('GIF_ANIMATED_SOURCE');
      offset += 8 + size + (size % 2);
    }
  } else {
    throw new Error(buffer.toString('ascii', 0, 3) === 'GIF' ? 'GIF_ANIMATED_SOURCE' : 'GIF_INVALID');
  }
  const dimensions = imageDimensions(buffer.subarray(0, 4 * 1024 * 1024), extension);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error('GIF_INVALID');
  if (dimensions.width * dimensions.height > GIF_MAX_SOURCE_PIXELS) throw new Error('GIF_LIMIT');
  return { ...dimensions, extension, mimeType };
}
