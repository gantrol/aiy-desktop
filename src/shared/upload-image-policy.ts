import { gifMetadata } from '@/shared/gif-metadata';

export const MAX_UPLOAD_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_IMAGE_DIMENSION = 32_768;
export const MAX_UPLOAD_IMAGE_PIXELS = 100_000_000;
export const BALANCED_UPLOAD_IMAGE_MAX_EDGE = 2_560;
export const BALANCED_UPLOAD_IMAGE_QUALITY = 0.85;

export type UploadImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export type CompressibleUploadImageMimeType = Exclude<UploadImageMimeType, 'image/gif'>;

export interface UploadImageMetadata {
  mimeType: UploadImageMimeType;
  width: number;
  height: number;
  orientation: number;
  animated: boolean;
}

function invalid(): never {
  throw new Error('UPLOAD_IMAGE_INVALID');
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || offset + length > bytes.byteLength) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function exifOrientation(bytes: Uint8Array) {
  const offset = ascii(bytes, 0, 6) === 'Exif\0\0' ? 6 : 0;
  if (bytes.byteLength - offset < 8) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
  const order = ascii(bytes, offset, 2);
  if (order !== 'II' && order !== 'MM') invalid();
  const littleEndian = order === 'II';
  if (view.getUint16(2, littleEndian) !== 42) invalid();
  const directory = view.getUint32(4, littleEndian);
  if (directory < 8 || directory + 2 > view.byteLength) invalid();
  const count = view.getUint16(directory, littleEndian);
  if (directory + 2 + count * 12 + 4 > view.byteLength) invalid();
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12;
    if (view.getUint16(entry, littleEndian) !== 0x0112) continue;
    if (view.getUint16(entry + 2, littleEndian) !== 3 || view.getUint32(entry + 4, littleEndian) !== 1) invalid();
    const orientation = view.getUint16(entry + 8, littleEndian);
    if (orientation < 1 || orientation > 8) invalid();
    return orientation;
  }
  return 1;
}

function jpegMetadata(bytes: Uint8Array): Omit<UploadImageMetadata, 'mimeType'> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 4 || view.getUint16(0) !== 0xffd8 || view.getUint16(bytes.byteLength - 2) !== 0xffd9)
    invalid();
  let offset = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (offset + 2 > bytes.byteLength) invalid();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.byteLength - 2) invalid();
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame) {
      if (length < 8 || width || length !== 8 + bytes[offset + 7] * 3) invalid();
      height = view.getUint16(offset + 3);
      width = view.getUint16(offset + 5);
    }
    if (marker === 0xe1 && ascii(bytes, offset + 2, 6) === 'Exif\0\0') {
      orientation = exifOrientation(bytes.subarray(offset + 2, offset + length));
    }
    if (marker === 0xda) {
      if (!width || !height || length < 6 || length !== 6 + bytes[offset + 2] * 2) invalid();
      return { width, height, orientation, animated: false };
    }
    offset += length;
  }
  return invalid();
}

function pngHeader(view: DataView, offset: number, length: number) {
  if (offset !== 8 || length !== 13) invalid();
  const data = offset + 8;
  const depths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    !depths[view.getUint8(data + 9)]?.includes(view.getUint8(data + 8)) ||
    view.getUint8(data + 10) ||
    view.getUint8(data + 11) ||
    view.getUint8(data + 12) > 1
  )
    invalid();
  return { width: view.getUint32(data), height: view.getUint32(data + 4) };
}

interface PngAnimationState {
  expectedFrames: number;
  frames: number;
  sequence: number;
  frameHasData: boolean;
  imageData: number;
  seenImageData: boolean;
}

function validatePngFrameControl(
  view: DataView,
  data: number,
  length: number,
  canvas: { width: number; height: number },
  state: Omit<PngAnimationState, 'imageData'>,
) {
  if (
    !state.expectedFrames ||
    length !== 26 ||
    (state.frames > 0 && !state.frameHasData) ||
    view.getUint32(data) !== state.sequence
  )
    invalid();
  const frameWidth = view.getUint32(data + 4);
  const frameHeight = view.getUint32(data + 8);
  const x = view.getUint32(data + 12);
  const y = view.getUint32(data + 16);
  if (
    !frameWidth ||
    !frameHeight ||
    x + frameWidth > canvas.width ||
    y + frameHeight > canvas.height ||
    view.getUint8(data + 24) > 2 ||
    view.getUint8(data + 25) > 1
  )
    invalid();
  if (!state.seenImageData && (frameWidth !== canvas.width || frameHeight !== canvas.height || x || y)) invalid();
}

function validatePngAnimationData(
  view: DataView,
  data: number,
  length: number,
  state: Pick<PngAnimationState, 'expectedFrames' | 'frames' | 'imageData' | 'sequence'>,
) {
  if (
    !state.expectedFrames ||
    !state.frames ||
    !state.imageData ||
    length <= 4 ||
    view.getUint32(data) !== state.sequence
  )
    invalid();
}

function validatePngEnd(
  length: number,
  end: number,
  bytesLength: number,
  state: Pick<PngAnimationState, 'imageData' | 'frames' | 'expectedFrames' | 'frameHasData'>,
) {
  if (
    length ||
    end + 4 !== bytesLength ||
    !state.imageData ||
    state.frames !== state.expectedFrames ||
    (state.frames > 0 && !state.frameHasData)
  )
    invalid();
}

function pngMetadata(bytes: Uint8Array): Omit<UploadImageMetadata, 'mimeType'> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) invalid();
  let offset = 8;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let imageData = 0;
  let seenImageData = false;
  let imageDataClosed = false;
  let expectedFrames = 0;
  let frames = 0;
  let sequence = 0;
  let frameHasData = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const data = offset + 8;
    const end = data + length;
    if (end + 4 > bytes.byteLength || (!width && type !== 'IHDR')) invalid();
    if (seenImageData && type !== 'IDAT') imageDataClosed = true;
    if (type === 'IHDR') {
      ({ width, height } = pngHeader(view, offset, length));
    } else if (type === 'acTL') {
      if (length !== 8 || expectedFrames || seenImageData) invalid();
      expectedFrames = view.getUint32(data);
      if (!expectedFrames) invalid();
    } else if (type === 'fcTL') {
      validatePngFrameControl(
        view,
        data,
        length,
        { width, height },
        { expectedFrames, frames, frameHasData, sequence, seenImageData },
      );
      sequence += 1;
      frames += 1;
      frameHasData = false;
    } else if (type === 'fdAT') {
      validatePngAnimationData(view, data, length, { expectedFrames, frames, imageData, sequence });
      sequence += 1;
      frameHasData = true;
    } else if (type === 'IDAT') {
      if (frames > 1 || imageDataClosed) invalid();
      seenImageData = true;
      imageData += length;
      if (frames && length) frameHasData = true;
    } else if (type === 'eXIf') {
      orientation = exifOrientation(bytes.subarray(data, end));
    } else if (type === 'IEND') {
      validatePngEnd(length, end, bytes.byteLength, { imageData, frames, expectedFrames, frameHasData });
      return { width, height, orientation, animated: expectedFrames > 0 };
    }
    offset = end + 4;
  }
  return invalid();
}

function uint24(view: DataView, offset: number) {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

function webpBitstreamSize(bytes: Uint8Array, type: string, start: number, length: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    type === 'VP8 ' &&
    length >= 10 &&
    bytes[start + 3] === 0x9d &&
    bytes[start + 4] === 0x01 &&
    bytes[start + 5] === 0x2a
  ) {
    return { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff };
  }
  if (type === 'VP8L' && length >= 5 && bytes[start] === 0x2f && bytes[start + 4] >> 5 === 0) {
    return {
      width: 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8),
      height: 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10),
    };
  }
  return invalid();
}

function webpFrameSize(bytes: Uint8Array, start: number, end: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dimensions: { width: number; height: number } | null = null;
  let offset = start;
  while (offset + 8 <= end) {
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const next = offset + 8 + length + (length % 2);
    if (next > end) invalid();
    if (type === 'VP8 ' || type === 'VP8L') {
      if (dimensions) invalid();
      dimensions = webpBitstreamSize(bytes, type, offset + 8, length);
    }
    offset = next;
  }
  if (offset !== end || !dimensions) invalid();
  return dimensions;
}

function webpCanvas(view: DataView, offset: number, length: number) {
  const data = offset + 8;
  if (offset !== 12 || length !== 10 || view.getUint8(data) & 0xc1 || uint24(view, data + 1)) invalid();
  return {
    width: uint24(view, data + 4) + 1,
    height: uint24(view, data + 7) + 1,
    animated: Boolean(view.getUint8(data) & 0x02),
  };
}

function validateWebpFrame(
  bytes: Uint8Array,
  data: number,
  length: number,
  canvas: { width: number; height: number; animated: boolean; animationHeader: boolean },
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!canvas.animated || !canvas.animationHeader || length < 24 || bytes[data + 15] & 0xfc) invalid();
  const frameWidth = uint24(view, data + 6) + 1;
  const frameHeight = uint24(view, data + 9) + 1;
  if (uint24(view, data) * 2 + frameWidth > canvas.width || uint24(view, data + 3) * 2 + frameHeight > canvas.height)
    invalid();
  const dimensions = webpFrameSize(bytes, data + 16, data + length);
  if (dimensions.width !== frameWidth || dimensions.height !== frameHeight) invalid();
}

function webpMetadata(bytes: Uint8Array): Omit<UploadImageMetadata, 'mimeType'> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 20 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP' ||
    view.getUint32(4, true) + 8 !== bytes.byteLength
  )
    invalid();
  let offset = 12;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let extended = false;
  let animated = false;
  let animationHeader = false;
  let frames = 0;
  let staticImage = false;
  while (offset + 8 <= bytes.byteLength) {
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    const end = data + length;
    const next = end + (length % 2);
    if (next > bytes.byteLength) invalid();
    if (type === 'VP8X') {
      ({ width, height, animated } = webpCanvas(view, offset, length));
      extended = true;
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (animated || staticImage) invalid();
      const dimensions = webpBitstreamSize(bytes, type, data, length);
      if (extended && (dimensions.width !== width || dimensions.height !== height)) invalid();
      ({ width, height } = dimensions);
      staticImage = true;
    } else if (type === 'ANIM') {
      if (!animated || animationHeader || frames || length !== 6) invalid();
      animationHeader = true;
    } else if (type === 'ANMF') {
      validateWebpFrame(bytes, data, length, { width, height, animated, animationHeader });
      frames += 1;
    } else if (type === 'EXIF') {
      if (!extended) invalid();
      orientation = exifOrientation(bytes.subarray(data, end));
    }
    offset = next;
  }
  if (offset !== bytes.byteLength || !width || !height || (animated ? !frames : !staticImage)) invalid();
  return { width, height, orientation, animated };
}

export function inspectUploadImage(bytes: Uint8Array, mimeType: string): UploadImageMetadata {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error('UPLOAD_IMAGE_BYTES_EXCEEDED');
  }
  const normalizedMimeType = mimeType.trim().toLowerCase();
  let metadata: Omit<UploadImageMetadata, 'mimeType'>;
  if (normalizedMimeType === 'image/jpeg') metadata = jpegMetadata(bytes);
  else if (normalizedMimeType === 'image/png') metadata = pngMetadata(bytes);
  else if (normalizedMimeType === 'image/webp') metadata = webpMetadata(bytes);
  else if (normalizedMimeType === 'image/gif') {
    try {
      const gif = gifMetadata(bytes, { requireFullCanvasFrames: false, maxFrames: 10_000 });
      metadata = { width: gif.width, height: gif.height, orientation: 1, animated: gif.durations.length > 1 };
    } catch {
      return invalid();
    }
  } else throw new Error('UPLOAD_IMAGE_FORMAT_UNSUPPORTED');
  const { width, height } = metadata;
  if (
    !width ||
    !height ||
    width > MAX_UPLOAD_IMAGE_DIMENSION ||
    height > MAX_UPLOAD_IMAGE_DIMENSION ||
    width * height > MAX_UPLOAD_IMAGE_PIXELS
  ) {
    throw new Error('UPLOAD_IMAGE_DIMENSIONS_EXCEEDED');
  }
  return { ...metadata, mimeType: normalizedMimeType };
}

export function uploadImageDimensions(width: number, height: number, maxEdge = BALANCED_UPLOAD_IMAGE_MAX_EDGE) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(maxEdge) ||
    maxEdge < 1
  )
    invalid();
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function orientedUploadImageDimensions(metadata: Pick<UploadImageMetadata, 'width' | 'height' | 'orientation'>) {
  return metadata.orientation >= 5
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

export function uploadImageOrientationTransform(
  metadata: Pick<UploadImageMetadata, 'width' | 'height' | 'orientation'>,
): [number, number, number, number, number, number] {
  const { width, height, orientation } = metadata;
  switch (orientation) {
    case 1:
      return [1, 0, 0, 1, 0, 0];
    case 2:
      return [-1, 0, 0, 1, width, 0];
    case 3:
      return [-1, 0, 0, -1, width, height];
    case 4:
      return [1, 0, 0, -1, 0, height];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, height, 0];
    case 7:
      return [0, -1, -1, 0, height, width];
    case 8:
      return [0, -1, 1, 0, 0, width];
    default:
      return invalid();
  }
}

// Chromium applies EXIF differently across formats. Decode this temporary copy and apply the original orientation once.
export function stripUploadImageExif(bytes: Uint8Array, mimeType: CompressibleUploadImageMimeType) {
  const metadata = inspectUploadImage(bytes, mimeType);
  if (metadata.animated) throw new Error('UPLOAD_IMAGE_ANIMATION_REQUIRES_ORIGINAL');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const removed: { start: number; end: number }[] = [];
  let offset = mimeType === 'image/jpeg' ? 2 : mimeType === 'image/png' ? 8 : 12;
  while (offset < bytes.byteLength) {
    if (mimeType === 'image/jpeg') {
      const start = offset;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset);
      const end = offset + length;
      if (marker === 0xe1 && ascii(bytes, offset + 2, 6) === 'Exif\0\0') removed.push({ start, end });
      offset = end;
    } else {
      const png = mimeType === 'image/png';
      const type = ascii(bytes, offset + (png ? 4 : 0), 4);
      const length = view.getUint32(offset + (png ? 0 : 4), !png);
      const end = offset + 8 + length + (png ? 4 : length % 2);
      if (type === (png ? 'eXIf' : 'EXIF')) removed.push({ start: offset, end });
      offset = end;
    }
  }
  if (!removed.length) return bytes;
  const stripped = new Uint8Array(bytes.byteLength - removed.reduce((sum, part) => sum + part.end - part.start, 0));
  let sourceOffset = 0;
  let outputOffset = 0;
  for (const part of removed) {
    stripped.set(bytes.subarray(sourceOffset, part.start), outputOffset);
    outputOffset += part.start - sourceOffset;
    sourceOffset = part.end;
  }
  stripped.set(bytes.subarray(sourceOffset), outputOffset);
  if (mimeType === 'image/webp') {
    new DataView(stripped.buffer).setUint32(4, stripped.byteLength - 8, true);
    stripped[20] &= ~0x08;
  }
  return stripped;
}
