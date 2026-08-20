import { lstatSync, readFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflate } from 'node:zlib';
import { MAX_IMAGE_DECODER_PIXELS } from '@/shared/image-decoder-protocol';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_PNG_FILE_BYTES = 256 * 1024 * 1024;
const MAX_PNG_DIMENSION = 65_535;
const MAX_PNG_PIXELS = 268_435_456;
const MAX_PNG_CHUNKS = 65_536;

const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC_TABLE.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC_TABLE[value] = crc >>> 0;
}

export interface ValidPngStructure {
  width: number;
  height: number;
}

function crc32(bytes: Buffer, start: number, end: number) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc = CRC_TABLE[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function crc32Async(bytes: Buffer, start: number, end: number) {
  let crc = 0xffffffff;
  const yieldBytes = 1024 * 1024;
  let nextYield = start + yieldBytes;
  for (let offset = start; offset < end; offset += 1) {
    crc = CRC_TABLE[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8);
    if (offset >= nextYield) {
      nextYield += yieldBytes;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validChunkType(bytes: Buffer, offset: number) {
  for (let index = 0; index < 4; index += 1) {
    const character = bytes[offset + index];
    if (!((character >= 65 && character <= 90) || (character >= 97 && character <= 122))) return false;
  }
  return true;
}

function validColorFormat(bitDepth: number, colorType: number) {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(bitDepth);
  if (colorType === 2) return bitDepth === 8 || bitDepth === 16;
  if (colorType === 3) return [1, 2, 4, 8].includes(bitDepth);
  if (colorType === 4 || colorType === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

/**
 * Validates the complete PNG container without decoding pixels. This rejects
 * truncated or concatenated files, corrupt chunk CRCs, unsafe dimensions, and
 * malformed critical-chunk ordering before a recovered output is committed.
 */
interface PngCrcStep {
  start: number;
  end: number;
}

interface PngChunk {
  dataLength: number;
  typeOffset: number;
  dataOffset: number;
  dataEnd: number;
  chunkEnd: number;
  type: string;
}

function readPngChunk(bytes: Buffer, offset: number): PngChunk | null {
  if (bytes.length - offset < 12) return null;
  const dataLength = bytes.readUInt32BE(offset);
  if (dataLength > 0x7fffffff) return null;
  const typeOffset = offset + 4;
  const dataOffset = typeOffset + 4;
  const dataEnd = dataOffset + dataLength;
  const chunkEnd = dataEnd + 4;
  if (chunkEnd > bytes.length || !validChunkType(bytes, typeOffset)) return null;
  return {
    dataLength,
    typeOffset,
    dataOffset,
    dataEnd,
    chunkEnd,
    type: bytes.toString('ascii', typeOffset, dataOffset),
  };
}

function readPngHeader(bytes: Buffer, chunk: PngChunk, offset: number, sawHeader: boolean) {
  if (sawHeader || offset !== PNG_SIGNATURE.length || chunk.dataLength !== 13) return null;
  const width = bytes.readUInt32BE(chunk.dataOffset);
  const height = bytes.readUInt32BE(chunk.dataOffset + 4);
  const bitDepth = bytes[chunk.dataOffset + 8];
  const colorType = bytes[chunk.dataOffset + 9];
  const compression = bytes[chunk.dataOffset + 10];
  const filter = bytes[chunk.dataOffset + 11];
  const interlace = bytes[chunk.dataOffset + 12];
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_PNG_DIMENSION ||
    height > MAX_PNG_DIMENSION ||
    width * height > MAX_PNG_PIXELS ||
    !validColorFormat(bitDepth, colorType) ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    return null;
  }
  return { width, height, colorType };
}

function validPngPalette(chunk: PngChunk, sawPalette: boolean, sawImageData: boolean, colorType: number) {
  return (
    !sawPalette &&
    !sawImageData &&
    colorType !== 0 &&
    colorType !== 4 &&
    chunk.dataLength > 0 &&
    chunk.dataLength <= 768 &&
    chunk.dataLength % 3 === 0
  );
}

function* pngValidationSteps(bytes: Buffer): Generator<PngCrcStep, ValidPngStructure | null, number> {
  if (bytes.length < 57 || bytes.length > MAX_PNG_FILE_BYTES) return null;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let imageDataBytes = 0;
  let chunkCount = 0;

  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > MAX_PNG_CHUNKS) return null;
    const chunk = readPngChunk(bytes, offset);
    if (!chunk) return null;
    const chunkCrc = yield { start: chunk.typeOffset, end: chunk.dataEnd };
    if (chunkCrc !== bytes.readUInt32BE(chunk.dataEnd)) return null;

    if (!sawHeader && chunk.type !== 'IHDR') return null;
    if (sawImageData && chunk.type !== 'IDAT') imageDataEnded = true;

    if (chunk.type === 'IHDR') {
      const header = readPngHeader(bytes, chunk, offset, sawHeader);
      if (!header) return null;
      ({ width, height, colorType } = header);
      sawHeader = true;
    } else if (chunk.type === 'PLTE') {
      if (!validPngPalette(chunk, sawPalette, sawImageData, colorType)) return null;
      sawPalette = true;
    } else if (chunk.type === 'IDAT') {
      if (imageDataEnded || (colorType === 3 && !sawPalette)) return null;
      sawImageData = true;
      imageDataBytes += chunk.dataLength;
    } else if (chunk.type === 'IEND') {
      if (chunk.dataLength !== 0 || !sawImageData || imageDataBytes === 0 || chunk.chunkEnd !== bytes.length) {
        return null;
      }
      return { width, height };
    } else if ((bytes[chunk.typeOffset] & 0x20) === 0) {
      // Unknown critical chunks cannot be safely interpreted.
      return null;
    }

    offset = chunk.chunkEnd;
  }
  return null;
}

export function validatePngStructure(bytes: Buffer): ValidPngStructure | null {
  const validation = pngValidationSteps(bytes);
  let step = validation.next();
  while (!step.done) {
    step = validation.next(crc32(bytes, step.value.start, step.value.end));
  }
  return step.value;
}

export async function validatePngStructureAsync(bytes: Buffer): Promise<ValidPngStructure | null> {
  const validation = pngValidationSteps(bytes);
  let step = validation.next();
  while (!step.done) {
    step = validation.next(await crc32Async(bytes, step.value.start, step.value.end));
  }
  return step.value;
}

interface CanonicalCanvasPng {
  width: number;
  height: number;
  imageData: Buffer[];
}

function canonicalCanvasPng(bytes: Buffer): CanonicalCanvasPng | null {
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let chunkCount = 0;
  let sawHeader = false;
  let sawImageData = false;
  const imageData: Buffer[] = [];

  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > MAX_PNG_CHUNKS || bytes.length - offset < 12) return null;
    const dataLength = bytes.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + dataLength;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) return null;
    const type = bytes.toString('ascii', typeOffset, dataOffset);

    if (type === 'IHDR') {
      if (sawHeader || offset !== PNG_SIGNATURE.length || dataLength !== 13) return null;
      width = bytes.readUInt32BE(dataOffset);
      height = bytes.readUInt32BE(dataOffset + 4);
      if (
        bytes[dataOffset + 8] !== 8 ||
        bytes[dataOffset + 9] !== 6 ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        bytes[dataOffset + 12] !== 0
      ) {
        return null;
      }
      sawHeader = true;
    } else if (type === 'IDAT') {
      if (!sawHeader || !dataLength) return null;
      sawImageData = true;
      imageData.push(bytes.subarray(dataOffset, dataEnd));
    } else if (type === 'IEND') {
      if (!sawHeader || !sawImageData || dataLength !== 0 || chunkEnd !== bytes.length) return null;
      return { width, height, imageData };
    } else {
      return null;
    }
    offset = chunkEnd;
  }
  return null;
}

async function hasDecodableCanvasRaster(png: CanonicalCanvasPng) {
  const rowLength = 1 + png.width * 4;
  const expectedBytes = rowLength * png.height;
  let decodedBytes = 0;
  let rowOffset = 0;
  let rows = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        let offset = 0;
        while (offset < chunk.byteLength) {
          if (rowOffset === 0) {
            if (chunk[offset] > 4) throw new Error('PNG scanline uses an invalid filter');
            offset += 1;
            decodedBytes += 1;
            rowOffset = 1;
          }
          const take = Math.min(rowLength - rowOffset, chunk.byteLength - offset);
          offset += take;
          decodedBytes += take;
          rowOffset += take;
          if (decodedBytes > expectedBytes) throw new Error('PNG raster exceeds its declared dimensions');
          if (rowOffset === rowLength) {
            rows += 1;
            rowOffset = 0;
          }
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  try {
    await pipeline(Readable.from(png.imageData, { objectMode: false }), createInflate({ chunkSize: 64 * 1024 }), sink);
  } catch {
    return false;
  }
  return decodedBytes === expectedBytes && rows === png.height && rowOffset === 0;
}

/**
 * Validates the exact metadata-free RGBA PNG shape emitted by Chromium canvas,
 * then streams and bounds the IDAT inflate so corrupt raster data cannot be
 * committed merely because its chunk container and CRCs are valid.
 */
export async function validateCanvasPngAsync(bytes: Buffer): Promise<ValidPngStructure | null> {
  const structure = await validatePngStructureAsync(bytes);
  if (!structure || structure.width * structure.height > MAX_IMAGE_DECODER_PIXELS) return null;
  const canonical = canonicalCanvasPng(bytes);
  if (
    !canonical ||
    canonical.width !== structure.width ||
    canonical.height !== structure.height ||
    !(await hasDecodableCanvasRaster(canonical))
  ) {
    return null;
  }
  return structure;
}

interface GenericPngRaster {
  bitDepth: number;
  colorType: number;
  interlace: number;
  imageData: Buffer[];
}

function genericPngRaster(bytes: Buffer): GenericPngRaster | null {
  let offset = PNG_SIGNATURE.length;
  let bitDepth = -1;
  let colorType = -1;
  let interlace = -1;
  const imageData: Buffer[] = [];
  while (offset < bytes.length) {
    const chunk = readPngChunk(bytes, offset);
    if (!chunk) return null;
    if (chunk.type === 'IHDR') {
      bitDepth = bytes[chunk.dataOffset + 8];
      colorType = bytes[chunk.dataOffset + 9];
      interlace = bytes[chunk.dataOffset + 12];
    } else if (chunk.type === 'IDAT') {
      imageData.push(bytes.subarray(chunk.dataOffset, chunk.dataEnd));
    } else if (chunk.type === 'IEND') {
      return bitDepth > 0 && colorType >= 0 && imageData.length > 0
        ? { bitDepth, colorType, interlace, imageData }
        : null;
    }
    offset = chunk.chunkEnd;
  }
  return null;
}

function passDimension(size: number, start: number, stride: number) {
  return size <= start ? 0 : Math.ceil((size - start) / stride);
}

function pngRasterRowPayloadBytes(structure: ValidPngStructure, raster: GenericPngRaster) {
  const channels =
    raster.colorType === 0 || raster.colorType === 3 ? 1 : raster.colorType === 2 ? 3 : raster.colorType === 4 ? 2 : 4;
  const bitsPerPixel = channels * raster.bitDepth;
  const passes =
    raster.interlace === 0
      ? [[0, 0, 1, 1] as const]
      : ([
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ] as const);
  const rows: number[] = [];
  for (const [startX, startY, strideX, strideY] of passes) {
    const width = passDimension(structure.width, startX, strideX);
    const height = passDimension(structure.height, startY, strideY);
    if (width === 0 || height === 0) continue;
    const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
    for (let row = 0; row < height; row += 1) rows.push(rowBytes);
  }
  return rows;
}

async function hasDecodablePngRaster(imageData: readonly Buffer[], rowPayloadBytes: readonly number[]) {
  const expectedBytes = rowPayloadBytes.reduce((total, rowBytes) => total + rowBytes + 1, 0);
  let decodedBytes = 0;
  let rowIndex = 0;
  let remainingInRow = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        let offset = 0;
        while (offset < chunk.byteLength) {
          if (remainingInRow === 0) {
            if (rowIndex >= rowPayloadBytes.length || chunk[offset] > 4) {
              throw new Error('PNG raster has an invalid scanline');
            }
            remainingInRow = rowPayloadBytes[rowIndex++];
            offset += 1;
            decodedBytes += 1;
          }
          const take = Math.min(remainingInRow, chunk.byteLength - offset);
          remainingInRow -= take;
          offset += take;
          decodedBytes += take;
          if (decodedBytes > expectedBytes) throw new Error('PNG raster exceeds its declared dimensions');
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  try {
    await pipeline(Readable.from(imageData, { objectMode: false }), createInflate({ chunkSize: 64 * 1024 }), sink);
  } catch {
    return false;
  }
  return decodedBytes === expectedBytes && rowIndex === rowPayloadBytes.length && remainingInRow === 0;
}

export async function validateDecodablePngAsync(bytes: Buffer): Promise<ValidPngStructure | null> {
  const structure = await validatePngStructureAsync(bytes);
  if (!structure || structure.width * structure.height > MAX_IMAGE_DECODER_PIXELS) return null;
  const raster = genericPngRaster(bytes);
  if (!raster) return null;
  const rowPayloadBytes = pngRasterRowPayloadBytes(structure, raster);
  return rowPayloadBytes.length > 0 && (await hasDecodablePngRaster(raster.imageData, rowPayloadBytes))
    ? structure
    : null;
}

export function validatePngFile(filePath: string): ValidPngStructure | null {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 57 || stats.size > MAX_PNG_FILE_BYTES) return null;
  return validatePngStructure(readFileSync(filePath));
}

export async function validatePngFileAsync(filePath: string): Promise<ValidPngStructure | null> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 57 || stats.size > MAX_PNG_FILE_BYTES) return null;
    return validateDecodablePngAsync(await readFile(filePath));
  } catch {
    return null;
  }
}
