function pngSize(data: Buffer): { width: number; height: number } | null {
  const signature = '89504e470d0a1a0a';
  if (data.length < 24 || data.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function jpegSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const sizeMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  const scanLimit = Math.min(data.length, 4 * 1024 * 1024);
  let offset = 2;
  while (offset + 3 < scanLimit) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < scanLimit && data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= scanLimit) return null;
    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > scanLimit) return null;
    if (sizeMarkers.has(marker) && segmentLength >= 7) {
      return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

function readUInt24LE(data: Buffer, offset: number) {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function webpSize(data: Buffer): { width: number; height: number } | null {
  if (
    data.length < 20 ||
    data.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    data.subarray(8, 12).toString('ascii') !== 'WEBP'
  )
    return null;
  const chunk = data.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X' && data.length >= 30) {
    return { width: readUInt24LE(data, 24) + 1, height: readUInt24LE(data, 27) + 1 };
  }
  if (chunk === 'VP8 ' && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
    const width = 1 + data[21] + ((data[22] & 0x3f) << 8);
    const height = 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10);
    return { width, height };
  }
  return null;
}

function gifSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 10) return null;
  const signature = data.subarray(0, 6).toString('ascii');
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}

function svgRootTag(source: string) {
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (offset < source.length) {
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
    if (source.startsWith('<?xml', offset)) {
      const end = source.indexOf('?>', offset + 5);
      if (end < 0) return null;
      offset = end + 2;
      continue;
    }
    if (source.startsWith('<!--', offset)) {
      const end = source.indexOf('-->', offset + 4);
      if (end < 0) return null;
      offset = end + 3;
      continue;
    }
    break;
  }
  if (!/^<svg(?:\s|>)/iu.test(source.slice(offset, offset + 8))) return null;
  let quote = '';
  for (let index = offset + 4; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return source.slice(offset, index + 1);
  }
  return null;
}

function svgAttribute(tag: string, name: string) {
  const expression = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu');
  const match = expression.exec(tag);
  return match ? (match[1] ?? match[2] ?? '').trim() : null;
}

const svgUnitScale = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
} as const;

function svgLength(value: string | null) {
  if (!value) return null;
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc)?$/iu.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const unit = (match[2] ?? 'px').toLowerCase() as keyof typeof svgUnitScale;
  return parsed * svgUnitScale[unit];
}

function svgViewBox(value: string | null) {
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) {
    return null;
  }
  return { width: parts[2], height: parts[3] };
}

function svgSize(data: Buffer): { width: number; height: number } | null {
  const source = data.toString('utf8');
  if (!source || source.includes('\0') || source.includes('\ufffd')) return null;
  const tag = svgRootTag(source);
  if (!tag) return null;
  const width = svgLength(svgAttribute(tag, 'width'));
  const height = svgLength(svgAttribute(tag, 'height'));
  const viewBox = svgViewBox(svgAttribute(tag, 'viewBox'));
  let resolvedWidth = width;
  let resolvedHeight = height;
  if (viewBox && resolvedWidth && !resolvedHeight) resolvedHeight = (resolvedWidth * viewBox.height) / viewBox.width;
  if (viewBox && resolvedHeight && !resolvedWidth) resolvedWidth = (resolvedHeight * viewBox.width) / viewBox.height;
  resolvedWidth ??= viewBox?.width ?? 300;
  resolvedHeight ??= viewBox?.height ?? 150;
  const roundedWidth = Math.round(resolvedWidth);
  const roundedHeight = Math.round(resolvedHeight);
  return Number.isSafeInteger(roundedWidth) &&
    Number.isSafeInteger(roundedHeight) &&
    roundedWidth > 0 &&
    roundedHeight > 0
    ? { width: roundedWidth, height: roundedHeight }
    : null;
}

export function imageDimensions(data: Buffer, extension: string) {
  if (extension === '.png') return pngSize(data);
  if (extension === '.jpg' || extension === '.jpeg') return jpegSize(data);
  if (extension === '.webp') return webpSize(data);
  if (extension === '.gif') return gifSize(data);
  if (extension === '.svg') return svgSize(data);
  return null;
}
