import path from 'node:path';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import type { LibraryStorage } from '@/main/database/core/storage';
import { ImageSearchWorker } from '@/main/image-search/worker-client';
import { SearchRequestQueue } from '@/main/image-search/request-queue';
import { resolveImageSearchRuntime } from '@/main/image-search/runtime';
import { readVideoSearchSources } from '@/main/video-search/sources';
import { mediaUrl } from '@/main/database/core/values';
import { imageSearchErrorSchema } from '@/shared/contracts/image-search';
import { contentSearchQuery } from '@/shared/content-search-query';
import {
  videoSearchResultSchema,
  type VideoSearchInput,
  type VideoSearchResponse,
  type videoSearchOpenInputSchema,
} from '@/shared/contracts/video-search';

async function executable(name: 'ffmpeg' | 'ffprobe') {
  const configured = process.env[name === 'ffmpeg' ? 'AIY_FFMPEG_PATH' : 'AIY_FFPROBE_PATH']?.trim();
  if (configured) return configured;
  const filename = process.platform === 'win32' ? `${name}.exe` : name;
  const sibling = process.env.AIY_FFMPEG_PATH?.trim();
  const candidates = [
    ...(sibling && path.isAbsolute(sibling) ? [path.join(path.dirname(sibling), filename)] : []),
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'ffmpeg', filename)] : []),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Development can use PATH. */
    }
  }
  return filename;
}

export class VideoSearchService {
  private queue = new SearchRequestQueue();
  private worker: ImageSearchWorker | null = null;
  private runtimeKey = '';
  private disposed = false;
  constructor(private storage: LibraryStorage) {}
  cancel(id: string) {
    this.queue.cancel(id);
  }
  stop() {
    this.queue.stop();
    this.worker?.stop();
  }
  dispose() {
    this.disposed = true;
    this.stop();
  }
  get execution() {
    return this.worker?.execution ?? { backend: null, fallback: false };
  }

  open(input: z.infer<typeof videoSearchOpenInputSchema>) {
    const source = readVideoSearchSources(this.storage.db, [input.documentId])[0];
    return source?.hash === input.sourceHash && source.revision === input.revision
      ? { mediaUrl: mediaUrl(source.assetId) }
      : null;
  }

  async lookup(input: VideoSearchInput, configurationPath: string): Promise<VideoSearchResponse> {
    if (this.disposed) return { error: 'CANCELLED' };
    if (input.mode === 'HYBRID') {
      try {
        contentSearchQuery(input.query);
      } catch {
        return { error: 'INVALID_QUERY' };
      }
    }
    try {
      return await this.queue.run(input.requestId, async (signal) => {
        const runtime = await resolveImageSearchRuntime(configurationPath);
        signal.throwIfAborted();
        const runtimeKey = `${runtime.fingerprint}:${runtime.device}`;
        if (!this.worker || runtimeKey !== this.runtimeKey) {
          this.worker?.stop();
          this.worker = new ImageSearchWorker(
            runtime,
            path.join(this.storage.libraryRoot, '.cache', 'image-search', 'video-vectors.sqlite3'),
            'video',
          );
          this.runtimeKey = runtimeKey;
        }
        const identities = input.documentIds
          ? JSON.stringify(readVideoSearchSources(this.storage.db, input.documentIds))
          : null;
        const [ffmpeg, ffprobe] = await Promise.all([executable('ffmpeg'), executable('ffprobe')]);
        const response = z.object({ value: videoSearchResultSchema }).parse(
          await this.worker.request(
            {
              op: 'video-search',
              databasePath: this.storage.db.name,
              libraryRoot: this.storage.libraryRoot,
              ffmpeg,
              ffprobe,
              input,
            },
            signal,
          ),
        );
        signal.throwIfAborted();
        if (
          input.documentIds &&
          identities !== JSON.stringify(readVideoSearchSources(this.storage.db, input.documentIds))
        )
          throw new Error('CHANGED');
        // Whole-space enumeration runs off the main thread. Revalidate only the returned page here.
        const current = new Map(
          readVideoSearchSources(this.storage.db, [
            ...new Set(response.value.items.map((item) => item.documentId)),
          ]).map((source) => [source.id, source]),
        );
        if (
          response.value.items.some((item) => {
            const source = current.get(item.documentId);
            return !source || source.hash !== item.sourceHash || source.revision !== item.revision;
          })
        )
          throw new Error('CHANGED');
        return { result: response.value };
      });
    } catch (error) {
      const parsed = imageSearchErrorSchema.safeParse(error instanceof Error ? error.message : 'UNAVAILABLE');
      return { error: parsed.success ? parsed.data : 'UNAVAILABLE' };
    }
  }
}
