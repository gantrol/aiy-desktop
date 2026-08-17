import { nativeImage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createThumbnailInSandbox } from '@/main/media/image-thumbnail-worker-client';

const thumbnailVersion = 1;
const thumbnailSizes = [96, 192, 320] as const;

export function normalizeMediaThumbnailSize(value: string | null) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= thumbnailSizes[0]) return thumbnailSizes[0];
  return thumbnailSizes.find((size) => requested <= size) ?? thumbnailSizes.at(-1)!;
}

async function usableCachedFile(filePath: string) {
  try {
    return (await stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

export class MediaThumbnailCache {
  private activeTasks = 0;
  private readonly waitingTasks: Array<{ start(): void; reject(reason: Error): void }> = [];
  private readonly pending = new Map<string, Promise<string>>();
  private readonly abortController = new AbortController();
  private readonly concurrency: number;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly libraryRoot: string,
    legacyWorkerPathOrConcurrency?: string | number,
    concurrency = 3,
  ) {
    this.concurrency = typeof legacyWorkerPathOrConcurrency === 'number' ? legacyWorkerPathOrConcurrency : concurrency;
  }

  get(assetId: string, sourcePath: string, size: number) {
    if (this.disposed) return Promise.reject(this.closedError());
    const key = `${assetId}:${size}`;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const outputPath = this.outputPath(assetId, size);
    const request = (async () => {
      if (await usableCachedFile(outputPath)) return outputPath;
      return this.runLimited(() => this.create(sourcePath, outputPath, size));
    })().finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  dispose() {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.abortController.abort(this.closedError());
    for (const task of this.waitingTasks.splice(0)) task.reject(this.closedError());
    this.disposal = Promise.allSettled([...this.pending.values()]).then(() => undefined);
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
        void operation()
          .then(resolve, reject)
          .finally(() => {
            this.activeTasks -= 1;
            this.waitingTasks.shift()?.start();
          });
      };
      if (this.activeTasks < this.concurrency) start();
      else this.waitingTasks.push({ start, reject });
    });
  }

  private async create(sourcePath: string, outputPath: string, size: number) {
    this.abortController.signal.throwIfAborted();
    if (await usableCachedFile(outputPath)) {
      this.abortController.signal.throwIfAborted();
      return outputPath;
    }
    await mkdir(path.dirname(outputPath), { recursive: true });

    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return createThumbnailInSandbox(sourcePath, outputPath, size, this.abortController.signal);
    }

    let thumbnail = await nativeImage.createThumbnailFromPath(sourcePath, { width: size, height: size });
    this.abortController.signal.throwIfAborted();
    if (thumbnail.isEmpty()) {
      return createThumbnailInSandbox(sourcePath, outputPath, size, this.abortController.signal);
    }

    const dimensions = thumbnail.getSize();
    if (Math.max(dimensions.width, dimensions.height) > size) {
      thumbnail = thumbnail.resize({
        ...(dimensions.width >= dimensions.height ? { width: size } : { height: size }),
        quality: 'good',
      });
    }
    if (thumbnail.isEmpty()) throw new Error(`Image thumbnail resize failed: ${sourcePath}`);

    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, thumbnail.toPNG());
      this.abortController.signal.throwIfAborted();
      await rename(temporaryPath, outputPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    return outputPath;
  }

  private closedError() {
    return new Error('Media thumbnail cache is closed');
  }
}
