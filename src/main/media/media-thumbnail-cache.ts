import { nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createThumbnailInSandbox } from '@/main/media/image-thumbnail-worker-client';
import { writeThumbnailPng } from '@/main/media/write-thumbnail-png';
import { readSimpleSvgThumbnail } from '@/main/media/simple-svg-thumbnail';

const thumbnailVersion = 1;
const thumbnailSizes = [96, 192, 320, 512] as const;
// At most 4 MiB of validated SVG bytes per library; failures also occupy an entry.
const maximumSvgEntries = 128;

export function normalizeMediaThumbnailSize(value: string | null) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= thumbnailSizes[0]) return thumbnailSizes[0];
  return thumbnailSizes.find((size) => requested <= size) ?? thumbnailSizes.at(-1)!;
}

async function usableCachedFile(filePath: string) {
  try {
    const entry = await stat(filePath);
    return entry.isFile() && entry.size > 0;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export class MediaThumbnailCache {
  private activeTasks = 0;
  private readonly waitingTasks: Array<{ start(): void; reject(reason: Error): void }> = [];
  private readonly pending = new Map<string, Promise<string>>();
  private readonly svgPending = new Map<string, Promise<Buffer | null>>();
  private readonly svgSources = new Map<string, Buffer | null>();
  private readonly abortController = new AbortController();
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly libraryRoot: string,
    private readonly concurrency = 3,
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new RangeError('Media thumbnail concurrency must be a positive safe integer');
    }
  }

  get(assetId: string, sourcePath: string, size: number) {
    if (this.disposed) return Promise.reject(this.closedError());
    const key = `${assetId}:${size}`;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const outputPath = this.outputPath(assetId, size);
    const request = (async () => {
      // Warm-cache reads must not wait behind slow image decoding.
      const cached = await usableCachedFile(outputPath);
      this.abortController.signal.throwIfAborted();
      if (cached) return outputPath;
      const result = await this.runLimited(() => this.create(sourcePath, outputPath, size));
      this.abortController.signal.throwIfAborted();
      return result;
    })().finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  getSimpleSvg(assetId: string, sourcePath: string): Promise<Buffer | null> {
    if (this.disposed) return Promise.reject(this.closedError());
    if (path.extname(sourcePath).toLowerCase() !== '.svg') return Promise.resolve(null);
    const cached = this.svgSources.get(assetId);
    if (cached !== undefined) {
      this.svgSources.delete(assetId);
      this.svgSources.set(assetId, cached);
      return Promise.resolve(cached);
    }
    const existing = this.svgPending.get(assetId);
    if (existing) return existing;
    const request = this.runLimited(() => readSimpleSvgThumbnail(sourcePath, this.abortController.signal))
      .then((bytes) => {
        this.abortController.signal.throwIfAborted();
        if (this.svgSources.size >= maximumSvgEntries) this.svgSources.delete(this.svgSources.keys().next().value!);
        // Serve these exact validated bytes, never reopen a mutable discovery source after classification.
        this.svgSources.set(assetId, bytes);
        return bytes;
      })
      .finally(() => {
        this.svgPending.delete(assetId);
      });
    this.svgPending.set(assetId, request);
    return request;
  }

  dispose() {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.abortController.abort(this.closedError());
    this.svgSources.clear();
    for (const task of this.waitingTasks.splice(0)) task.reject(this.closedError());
    this.disposal = Promise.allSettled([...this.pending.values(), ...this.svgPending.values()]).then(() => undefined);
    return this.disposal;
  }

  private outputPath(assetId: string, size: number) {
    const assetKey = createHash('sha256').update(assetId).digest('hex');
    return path.join(
      this.libraryRoot,
      'temp',
      'media-thumbnails',
      `v${thumbnailVersion}`,
      String(size),
      `${assetKey}.png`,
    );
  }

  private runLimited<T>(operation: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        if (this.disposed) {
          reject(this.closedError());
          return;
        }
        this.activeTasks += 1;
        void Promise.resolve()
          .then(operation)
          .finally(() => {
            this.activeTasks -= 1;
            this.waitingTasks.shift()?.start();
          })
          .then(resolve, reject);
      };
      if (this.activeTasks < this.concurrency) start();
      else this.waitingTasks.push({ start, reject });
    });
  }

  private async create(sourcePath: string, outputPath: string, size: number) {
    this.abortController.signal.throwIfAborted();
    // Recheck after queueing before starting another decode.
    const cached = await usableCachedFile(outputPath);
    this.abortController.signal.throwIfAborted();
    if (cached) return outputPath;

    // SVG decoding is already supported internally; avoid slow system-provider probing.
    if (
      path.extname(sourcePath).toLowerCase() === '.svg' ||
      (process.platform !== 'darwin' && process.platform !== 'win32')
    ) {
      return createThumbnailInSandbox(sourcePath, outputPath, size, this.abortController.signal);
    }

    // System thumbnail providers vary by installed codecs. Rejection and an
    // empty result both mean the sandboxed still-image decoder must take over.
    const nativeThumbnail = await nativeImage
      .createThumbnailFromPath(sourcePath, { width: size, height: size })
      .catch(() => null);
    this.abortController.signal.throwIfAborted();
    if (!nativeThumbnail || nativeThumbnail.isEmpty()) {
      return createThumbnailInSandbox(sourcePath, outputPath, size, this.abortController.signal);
    }

    let thumbnail = nativeThumbnail;
    const dimensions = thumbnail.getSize();
    if (Math.max(dimensions.width, dimensions.height) > size) {
      thumbnail = thumbnail.resize({
        ...(dimensions.width >= dimensions.height ? { width: size } : { height: size }),
        quality: 'good',
      });
    }
    if (thumbnail.isEmpty()) throw new Error(`Image thumbnail resize failed: ${sourcePath}`);

    return writeThumbnailPng(outputPath, thumbnail.toPNG(), this.abortController.signal);
  }

  private closedError() {
    return new Error('Media thumbnail cache is closed');
  }
}
