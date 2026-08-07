/**
 * Writes the binary image fixtures under `tests/fixtures/images/`.
 *
 * Generated rather than committed-by-hand so every byte is reviewable and
 * reproducible: run the script, diff the output, and the fixtures are explained
 * by their source instead of being opaque blobs. No provider call is involved.
 *
 *   node scripts/generate-image-fixtures.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/images');

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** @param {(x: number, y: number) => [number, number, number, number]} shade */
function encodePng(width, height, shade) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = shade(x, y);
      const offset = y * (stride + 1) + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const checkerboard = (x, y) =>
  (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? [220, 90, 140, 255] : [40, 40, 60, 255];

/** Fully transparent left half, fully opaque right half: a legible edit mask. */
const halfAlphaMask = (x, _y, width = 64) => (x < width / 2 ? [0, 0, 0, 0] : [255, 255, 255, 255]);

const files = {
  'valid-64x64.png': encodePng(64, 64, checkerboard),
  'valid-1024x1024.png': encodePng(1024, 1024, checkerboard),
  // Same dimensions as the edit source: the adapter rejects mismatches.
  'mask-64x64.png': encodePng(64, 64, (x, y) => halfAlphaMask(x, y, 64)),
  // Dimensions deliberately differ from the source, to drive the mismatch path.
  'mask-mismatch-32x32.png': encodePng(32, 32, (x, y) => halfAlphaMask(x, y, 32)),
  // Valid signature and IHDR, truncated stream: decodes must fail, not hang.
  'corrupt.png': encodePng(64, 64, checkerboard).subarray(0, 80),
  // A JPEG magic number behind a .png name, for MIME-vs-extension checks.
  'mislabeled.png': Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120, 0x20)]),
};

mkdirSync(outputRoot, { recursive: true });
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(path.join(outputRoot, name), bytes);
  console.log(`${name.padEnd(28)} ${String(bytes.length).padStart(8)} bytes`);
}
console.log(`\nWrote ${Object.keys(files).length} fixtures to ${outputRoot}`);
