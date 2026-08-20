import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { link, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const svgRasterCacheVersion = 'v1';
const sha256Pattern = /^[a-f0-9]{64}$/u;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

function hasPngSignature(filePath: string) {
  try {
    const descriptor = openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(pngSignature.byteLength);
      return readSync(descriptor, header, 0, header.byteLength, 0) === header.byteLength && header.equals(pngSignature);
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return false;
  }
}

export function resolveSvgRasterCachePath(libraryRoot: string, sourceHash: string) {
  if (!sha256Pattern.test(sourceHash)) return null;
  return path.join(
    path.resolve(libraryRoot),
    'cache',
    'svg-raster',
    svgRasterCacheVersion,
    sourceHash.slice(0, 2),
    `${sourceHash}.png`,
  );
}

export function findSvgRasterCachePath(libraryRoot: string, sourceHash: string) {
  const filePath = resolveSvgRasterCachePath(libraryRoot, sourceHash);
  return filePath && hasPngSignature(filePath) ? filePath : null;
}

async function publishCacheFile(sourcePath: string, destination: string) {
  try {
    await link(sourcePath, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (hasPngSignature(destination)) return destination;
    await unlink(destination);
    try {
      await link(sourcePath, destination);
    } catch (replacementError) {
      if ((replacementError as NodeJS.ErrnoException).code !== 'EEXIST' || !hasPngSignature(destination)) {
        throw replacementError;
      }
    }
  }
  return destination;
}

export async function storeSvgRasterCacheFile(libraryRoot: string, sourceHash: string, sourcePath: string) {
  const destination = resolveSvgRasterCachePath(libraryRoot, sourceHash);
  if (!destination) throw new Error('SVG source hash is invalid');
  if (!hasPngSignature(sourcePath)) throw new Error('SVG raster cache is invalid');
  if (hasPngSignature(destination)) return destination;
  await mkdir(path.dirname(destination), { recursive: true });
  return publishCacheFile(sourcePath, destination);
}

export async function storeSvgRasterCache(libraryRoot: string, sourceHash: string, pngBytes: Uint8Array) {
  const destination = resolveSvgRasterCachePath(libraryRoot, sourceHash);
  if (!destination) throw new Error('SVG source hash is invalid');
  const png = Buffer.from(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  if (png.byteLength < pngSignature.byteLength || !png.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
    throw new Error('SVG raster cache is invalid');
  }
  if (hasPngSignature(destination)) return destination;

  await mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, png, { flag: 'wx' });
  try {
    return await publishCacheFile(temporaryPath, destination);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
