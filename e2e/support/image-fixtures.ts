import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { imageFixture } from '../../tests/support/fixtures';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * Produces a valid PNG with a large ignored ancillary chunk. This isolates file
 * reading, IPC transfer, hashing, and object-store I/O from pixel decode cost.
 */
export async function createPaddedPng(targetPath: string, paddingBytes: number, seed: number) {
  const source = await readFile(imageFixture('valid-1024x1024.png'));
  const iendOffset = source.length - 12;
  if (source.subarray(iendOffset + 4, iendOffset + 8).toString('ascii') !== 'IEND') {
    throw new Error('PNG fixture does not end in IEND');
  }
  const padding = Buffer.alloc(paddingBytes, seed & 0xff);
  const output = Buffer.concat([
    source.subarray(0, iendOffset),
    pngChunk('aiYp', padding),
    source.subarray(iendOffset),
  ]);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, output);
  return output.byteLength;
}

/** A highly compressed phone-photo-sized image that still decodes to all pixels. */
export async function createHighResolutionPng(targetPath: string, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('PNG dimensions must be positive integers');
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const row = Buffer.alloc(width * 4 + 1);
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = (x * 17) & 0xff;
    row[offset + 1] = (x * 7) & 0xff;
    row[offset + 2] = (x * 3) & 0xff;
    row[offset + 3] = 0xff;
  }
  const raw = Buffer.alloc(row.byteLength * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.byteLength);

  const output = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, output);
  return { byteSize: output.byteLength, width, height, decodedBytes: width * height * 4 };
}
