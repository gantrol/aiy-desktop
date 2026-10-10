import { lstat, mkdir, opendir, rename, statfs, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { z } from 'zod';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { readSvgRasterCacheBytes } from '@/main/media/svg-raster-cache';
import { validateDecodablePngAsync } from '@/main/media/png-validation';
import { validateSearchSvg } from '@/main/image-search/static-svg';
import {
  IMAGE_INPUT_POLICY,
  type imagePrepareCommandSchema,
  type PreparedImage,
} from '@/main/image-search/input-policy';
import type { ImageInputFailure } from '@/shared/contracts/image-search-issues';
import { writeWorkerDiagnostic } from '@/main/extensions/worker-diagnostics';

const MiB = 1024 * 1024;
const cacheBudget = 256 * MiB;
const sourceLimit = 1024 * MiB;
const pixelLimit = 1_000_000_000;
const formats = new Set(['png', 'jpeg', 'webp', 'gif', 'svg']);
const inputOptions = { limitInputPixels: false as const, sequentialRead: true, pages: 1, failOn: 'warning' as const };
type PrepareCommand = z.infer<typeof imagePrepareCommandSchema>;
sharp.cache(false);
sharp.concurrency(1);

function fail(reason: ImageInputFailure['reason'], actual?: number, limit?: number): never {
  throw Object.assign(new Error(reason), { failure: { reason, stage: 'prepare', actual, limit } });
}

async function readProxy(basePath: string, target: number, checkCancelled: () => void): Promise<PreparedImage | null> {
  for (const limited of [false, true]) {
    try {
      const destination = `${basePath}${limited ? '-limited' : ''}.png`;
      const cached = await readBoundedImageFile(destination, undefined, 24 * MiB);
      const info = await sharp(cached, { limitInputPixels: target * target }).metadata();
      if (info.width && info.height && info.width <= target && info.height <= target) {
        if (!(await validateDecodablePngAsync(cached))) continue;
        checkCancelled();
        const now = new Date();
        await utimes(destination, now, now);
        const entry = inventories.get(path.dirname(destination))?.get(destination);
        if (entry) entry.modified = now.getTime();
        return { path: destination, width: info.width, height: info.height, limited };
      }
    } catch {
      checkCancelled();
    }
  }
  return null;
}

async function sourceInput(command: PrepareCommand, root: string, size: number, checkCancelled: () => void) {
  if (command.mime !== 'image/svg+xml') {
    if (size > sourceLimit) fail('BYTE_LIMIT', size, sourceLimit);
    return { input: command.path as string | Buffer, fromStaticCache: false };
  }
  const cached = await readSvgRasterCacheBytes(root, command.hash);
  if (cached) return { input: cached, fromStaticCache: true };
  if (size > 25 * MiB) fail('BYTE_LIMIT', size, 25 * MiB);
  const input = await readBoundedImageFile(command.path, undefined, 25 * MiB);
  validateSearchSvg(input, checkCancelled);
  return { input, fromStaticCache: false };
}

async function sourceDimensions(input: string | Buffer, svg: boolean) {
  const metadata = await sharp(input, inputOptions).metadata();
  if (!metadata.format || !formats.has(metadata.format)) fail('UNSUPPORTED_FORMAT');
  const width = metadata.width ?? 0;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  if (!width || !height) fail('DECODE_FAILED');
  if (Math.max(width, height) > 1_000_000) fail('DIMENSION_LIMIT', Math.max(width, height), 1_000_000);
  if (!svg && width * height > pixelLimit) fail('PIXEL_LIMIT', width * height, pixelLimit);
  return { width, height };
}

function inputFailure(error: unknown): ImageInputFailure {
  const explicit = (error as { failure?: ImageInputFailure }).failure;
  if (explicit) return explicit;
  const code = (error as NodeJS.ErrnoException).code;
  const reasons: Record<string, ImageInputFailure['reason']> = {
    ENOENT: 'SOURCE_MISSING',
    EACCES: 'SOURCE_UNREADABLE',
    EPERM: 'SOURCE_UNREADABLE',
    ENOMEM: 'RESOURCE_LIMIT',
    ENOSPC: 'RESOURCE_LIMIT',
  };
  return {
    stage: 'prepare',
    reason:
      reasons[code ?? ''] ??
      (error instanceof Error && error.message === 'STATIC_IMAGE_UNAVAILABLE'
        ? 'STATIC_IMAGE_UNAVAILABLE'
        : 'DECODE_FAILED'),
  };
}

type CacheEntry = { path: string; size: number; modified: number };
const inventories = new Map<string, Map<string, CacheEntry>>();

async function cacheInventory(directory: string, checkCancelled: () => void) {
  const existing = inventories.get(directory);
  if (existing) return existing;
  const entries = new Map<string, CacheEntry>();
  const listing = await opendir(directory);
  for await (const entry of listing) {
    checkCancelled();
    if (!entry.isFile() || !/^[a-f0-9]{64}-(visual|ocr)(-limited)?\.(png|tmp)$/u.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const info = await lstat(filePath);
    if (entry.name.endsWith('.tmp')) {
      await unlink(filePath);
      continue;
    }
    entries.set(filePath, { path: filePath, size: info.size, modified: info.mtimeMs });
    if (entries.size > 512) fail('RESOURCE_LIMIT');
  }
  inventories.set(directory, entries);
  return entries;
}

/** Only our flat, versioned cache is swept; fresh files may still be consumed by an encoder. */
async function reserveCache(directory: string, bytes: number, checkCancelled: () => void) {
  const inventory = await cacheInventory(directory, checkCancelled);
  const entries = [...inventory.values()];
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries.sort((a, b) => a.modified - b.modified)) {
    if (total + bytes <= cacheBudget && inventory.size < 512) break;
    if (Date.now() - entry.modified < 5 * 60_000) continue;
    checkCancelled();
    await unlink(entry.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    total -= entry.size;
    inventory.delete(entry.path);
  }
  if (total + bytes > cacheBudget || inventory.size >= 512) fail('RESOURCE_LIMIT', total + bytes, cacheBudget);
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < bytes + 32 * MiB) fail('RESOURCE_LIMIT');
}

/** Native decode runs alone in a disposable process, before the model receives any pixels. */
export async function prepareImageInput(
  command: PrepareCommand,
  libraryRoot: string,
  checkCancelled: () => void,
): Promise<PreparedImage> {
  const directory = path.join(libraryRoot, '.cache', 'image-search', IMAGE_INPUT_POLICY);
  const basePath = path.join(directory, `${command.hash}-${command.purpose}`);
  const temporary = `${basePath}.tmp`;
  const target = command.purpose === 'visual' ? 1024 : 2560;
  let saving = false;
  try {
    checkCancelled();
    const before = await lstat(command.path);
    if (!before.isFile() || before.isSymbolicLink()) fail('SOURCE_UNREADABLE');
    await mkdir(directory, { recursive: true }).catch(() => fail('RESOURCE_LIMIT'));
    await cacheInventory(directory, checkCancelled);
    const cached = await readProxy(basePath, target, checkCancelled);
    if (cached) return cached;
    const svg = command.mime === 'image/svg+xml';
    const { input, fromStaticCache } = await sourceInput(command, libraryRoot, before.size, checkCancelled);
    checkCancelled();
    // Header inspection is separate from the old 16 MP model-input gate. SVG is scaled at load.
    const { width, height } = await sourceDimensions(input, svg);
    checkCancelled();
    let pipeline = sharp(input, inputOptions).rotate().resize({
      width: target,
      height: target,
      fit: 'inside',
      withoutEnlargement: true,
    });
    if (svg) pipeline = pipeline.flatten({ background: '#ffffff' });
    const output = await pipeline.removeAlpha().toColourspace('srgb').png().toBuffer({ resolveWithObject: true });
    checkCancelled();
    if (output.data.byteLength > 24 * MiB) fail('BYTE_LIMIT', output.data.byteLength, 24 * MiB);
    const after = await lstat(command.path);
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('CHANGED');
    saving = true;
    await reserveCache(directory, output.data.byteLength, checkCancelled);
    const limited = command.purpose === 'ocr' && (Math.max(width, height) > target || fromStaticCache);
    const destination = `${basePath}${limited ? '-limited' : ''}.png`;
    await writeFile(temporary, output.data, { flag: 'wx' });
    checkCancelled();
    await rename(temporary, destination);
    inventories
      .get(directory)
      ?.set(destination, { path: destination, size: output.data.byteLength, modified: Date.now() });
    return { path: destination, width: output.info.width, height: output.info.height, limited };
  } catch (error) {
    checkCancelled();
    if (error instanceof Error && error.message === 'CHANGED') throw error;
    writeWorkerDiagnostic('input-preparation-failed', { code: (error as NodeJS.ErrnoException).code ?? null }, error);
    return { failure: saving ? { reason: 'RESOURCE_LIMIT', stage: 'prepare' } : inputFailure(error) };
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
