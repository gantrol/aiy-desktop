import { deflateSync } from 'node:zlib';
import type { AnnotationDto } from '@/shared/contracts';

export const IMAGE_EDIT_MASK_RASTERIZER_VERSION = 1;
const RECTANGLE_PADDING = 0.01;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function paintDisk(
  pixels: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  value: 0 | 1,
) {
  const safeRadius = Math.max(0.5, radius);
  const radiusSquared = safeRadius * safeRadius;
  const left = clamp(Math.floor(centerX - safeRadius), 0, width - 1);
  const right = clamp(Math.ceil(centerX + safeRadius), 0, width - 1);
  const top = clamp(Math.floor(centerY - safeRadius), 0, height - 1);
  const bottom = clamp(Math.ceil(centerY + safeRadius), 0, height - 1);
  for (let y = top; y <= bottom; y += 1) {
    const pixelY = y + 0.5;
    for (let x = left; x <= right; x += 1) {
      const pixelX = x + 0.5;
      const dx = pixelX - centerX;
      const dy = pixelY - centerY;
      if (dx * dx + dy * dy <= radiusSquared) pixels[y * width + x] = value;
    }
  }
}

function paintCapsule(
  pixels: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  radius: number,
  value: 0 | 1,
) {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) {
    paintDisk(pixels, width, height, startX, startY, radius, value);
    return;
  }
  const safeRadius = Math.max(0.5, radius);
  const radiusSquared = safeRadius * safeRadius;
  const left = clamp(Math.floor(Math.min(startX, endX) - safeRadius), 0, width - 1);
  const right = clamp(Math.ceil(Math.max(startX, endX) + safeRadius), 0, width - 1);
  const top = clamp(Math.floor(Math.min(startY, endY) - safeRadius), 0, height - 1);
  const bottom = clamp(Math.ceil(Math.max(startY, endY) + safeRadius), 0, height - 1);
  for (let y = top; y <= bottom; y += 1) {
    const pixelY = y + 0.5;
    for (let x = left; x <= right; x += 1) {
      const pixelX = x + 0.5;
      const projection = clamp(((pixelX - startX) * dx + (pixelY - startY) * dy) / lengthSquared, 0, 1);
      const closestX = startX + projection * dx;
      const closestY = startY + projection * dy;
      const distanceX = pixelX - closestX;
      const distanceY = pixelY - closestY;
      if (distanceX * distanceX + distanceY * distanceY <= radiusSquared) {
        pixels[y * width + x] = value;
      }
    }
  }
}

function paintBrushAnnotation(target: Uint8Array, annotation: AnnotationDto, width: number, height: number) {
  const geometry = annotation.geometry;
  if (!geometry) throw new Error(`Brush annotation geometry is unavailable: ${annotation.id}`);
  const shortEdge = Math.min(width, height);
  for (const stroke of geometry.strokes) {
    const radius = Math.max(0.5, stroke.radius * shortEdge);
    const value = stroke.mode === 'ADD' ? 1 : 0;
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      paintDisk(target, width, height, point.x * width, point.y * height, radius, value);
      continue;
    }
    for (let index = 1; index < stroke.points.length; index += 1) {
      const start = stroke.points[index - 1];
      const end = stroke.points[index];
      paintCapsule(
        target,
        width,
        height,
        start.x * width,
        start.y * height,
        end.x * width,
        end.y * height,
        radius,
        value,
      );
    }
  }
}

function paintRectangleAnnotation(target: Uint8Array, annotation: AnnotationDto, width: number, height: number) {
  const shortEdge = Math.min(width, height);
  const padding = RECTANGLE_PADDING * shortEdge;
  const left = clamp(Math.floor(annotation.x * width - padding), 0, width - 1);
  const top = clamp(Math.floor(annotation.y * height - padding), 0, height - 1);
  const right = clamp(Math.ceil((annotation.x + (annotation.width ?? 0)) * width + padding), 0, width);
  const bottom = clamp(Math.ceil((annotation.y + (annotation.height ?? 0)) * height + padding), 0, height);
  for (let y = top; y < bottom; y += 1) target.fill(1, y * width + left, y * width + right);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.from(data);
  const chunk = Buffer.allocUnsafe(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return chunk;
}

function encodeAlphaMask(editable: Uint8Array, width: number, height: number) {
  const stride = width * 4;
  const scanlines = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const target = rowOffset + 1 + x * 4;
      scanlines[target] = 255;
      scanlines[target + 1] = 255;
      scanlines[target + 2] = 255;
      // OpenAI edits transparent mask pixels and preserves opaque pixels.
      scanlines[target + 3] = editable[y * width + x] ? 0 : 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function rasterizeImageEditMask(annotations: readonly AnnotationDto[], width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Image edit mask dimensions are invalid');
  }
  if (width * height > 8_500_000) throw new Error('Image edit mask exceeds the supported pixel count');
  const editable = new Uint8Array(width * height);
  for (const annotation of annotations) {
    const region = new Uint8Array(width * height);
    if (annotation.type === 'BRUSH') paintBrushAnnotation(region, annotation, width, height);
    else paintRectangleAnnotation(region, annotation, width, height);
    for (let index = 0; index < editable.length; index += 1) {
      if (region[index]) editable[index] = 1;
    }
  }
  if (!editable.some((value) => value === 1)) throw new Error('Image edit mask is empty');
  return encodeAlphaMask(editable, width, height);
}
