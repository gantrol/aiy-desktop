import path from 'node:path';
import type { LibraryStorage } from '@/main/database/core/storage';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { ImageSearchWorker } from '@/main/image-search/worker-client';
import { imagePreparedSchema, type PreparedImage } from '@/main/image-search/input-policy';
import { z } from 'zod';

const services = new WeakMap<LibraryStorage, ImageInputService>();
let preparationTail: Promise<unknown> = Promise.resolve();
export function imageInputService(storage: LibraryStorage) {
  let service = services.get(storage);
  if (!service) {
    service = new ImageInputService(storage.libraryRoot);
    services.set(storage, service);
  }
  return service;
}
export function disposeImageInputService(storage: LibraryStorage) {
  services.get(storage)?.stop();
  services.delete(storage);
}

/** All open libraries share one native preparation slot. Queued jobs own no input bytes. */
class ImageInputService {
  private readonly worker: ImageSearchWorker;
  constructor(root: string) {
    this.worker = new ImageSearchWorker(
      { model: '', fingerprint: 'prepare', device: 'CPU' },
      path.join(root, '.cache', 'image-search', 'vectors.sqlite3'),
      'prepare',
    );
  }
  stop() {
    this.worker.stop();
  }
  async prepare(file: ResolvedAssetFile, purpose: 'visual' | 'ocr', signal: AbortSignal): Promise<PreparedImage> {
    const previous = preparationTail;
    let release!: () => void;
    preparationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      signal.throwIfAborted();
      const response = z.object({ value: imagePreparedSchema }).parse(
        await this.worker.request(
          {
            op: 'prepare',
            path: file.absolutePath,
            hash: file.objectHash,
            mime: file.mimeType,
            purpose,
          },
          signal,
        ),
      );
      return response.value;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && error.message === 'CHANGED') throw error;
      return {
        failure: {
          stage: 'prepare',
          reason:
            error instanceof Error && error.message === 'RESOURCE_LIMIT'
              ? 'RESOURCE_LIMIT'
              : error instanceof Error && error.message === 'INDEX_TIMEOUT'
                ? 'INDEX_TIMEOUT'
                : 'INDEX_FAILED',
        },
      };
    } finally {
      release();
    }
  }
}
