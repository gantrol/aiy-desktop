import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { LibraryStorage } from '@/main/database/core/storage';
import type { ContentSearchRepository } from '@/main/database/search/content-search-repository';
import { resolveImageSearchRuntime } from '@/main/image-search/runtime';
import { ImageSearchWorker } from '@/main/image-search/worker-client';
import { SearchRequestQueue } from '@/main/image-search/request-queue';
import type { ImageSearchCommand } from '@/main/image-search/worker-protocol';
import { contentLookupResultSchema } from '@/shared/contracts/content-search';
import {
  imageSearchErrorSchema,
  type ContentSemanticInput,
  type ContentSemanticResponse,
} from '@/shared/contracts/image-search';

const searchResponse = z.object({
  generation: z.number(),
  coverage: contentLookupResultSchema.shape.coverage,
  items: z.array(contentLookupResultSchema.shape.items.element).max(31),
});

export class ContentSemanticSearch {
  private queue = new SearchRequestQueue();
  private worker: ImageSearchWorker | null = null;
  private runtimeKey = '';
  private catalog = '';
  private disposed = false;

  constructor(
    private storage: LibraryStorage,
    private sources: ContentSearchRepository,
  ) {}

  get execution() {
    return this.worker?.execution ?? { backend: null, fallback: false };
  }

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
  private revision() {
    return `${this.storage.getChangeRevision()}:${this.storage.db.pragma('data_version', { simple: true })}`;
  }

  lookupKeywords(
    input: ContentSemanticInput,
    warning: 'DISABLED' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'GPU_UNAVAILABLE',
  ): ContentSemanticResponse {
    const { query, type, offset, snapshot, advanceIndex, retryUnavailable } = input;
    return {
      result: { ...this.sources.lookup({ query, type, offset, snapshot, advanceIndex, retryUnavailable }), warning },
    };
  }

  async lookup(input: ContentSemanticInput, configurationPath: string): Promise<ContentSemanticResponse> {
    if (this.disposed) return { error: 'CANCELLED' };
    try {
      return await this.queue.run(input.requestId, async (signal) => {
        const runtime = await resolveImageSearchRuntime(configurationPath);
        signal.throwIfAborted();
        const runtimeKey = `${runtime.fingerprint}:${runtime.device}`;
        if (!this.worker || this.runtimeKey !== runtimeKey) {
          this.worker?.stop();
          this.worker = new ImageSearchWorker(
            runtime,
            path.join(this.storage.libraryRoot, '.cache', 'image-search', 'content-vectors.sqlite3'),
            'content',
          );
          this.runtimeKey = runtimeKey;
          this.catalog = '';
        }
        const worker = this.worker;
        const command = async (value: ImageSearchCommand) =>
          z.object({ value: z.unknown() }).parse(await worker.request(value, signal)).value;
        const revision = this.revision();
        const sourceGeneration = this.sources.prepareSemanticSources(
          input.type,
          input.advanceIndex,
          input.retryUnavailable,
        );
        const catalog = `${revision}:${sourceGeneration}`;
        if (this.catalog !== `${catalog}:${worker.generation}`) {
          this.catalog = '';
          await command({ op: 'content-sync-start' });
          let after = '';
          for (;;) {
            signal.throwIfAborted();
            const items = this.sources.listSemanticSources(after);
            if (!items.length) break;
            await command({ op: 'content-sync', items });
            after = items.at(-1)!.key;
          }
          if (revision !== this.revision()) throw new Error('CHANGED');
          await command({ op: 'content-sync-finish' });
          this.catalog = `${catalog}:${worker.generation}`;
        }
        // At most one passage per request; a cancelled search never queues a whole library of inference.
        if (input.advanceIndex && !input.offset)
          await command({ op: 'content-index', type: input.type, retry: input.retryUnavailable });
        let response = searchResponse.parse(
          await command({
            op: 'content-search',
            query: input.query,
            type: input.type,
            offset: input.offset,
            hybrid: input.mode === 'HYBRID',
          }),
        );
        const queryHash = createHash('sha256')
          .update(JSON.stringify([input.type, input.query, input.mode]))
          .digest('hex');
        const snapshot = `${catalog}:${worker.generation}:${response.generation}:${queryHash}`;
        const reset = Boolean(input.offset && input.snapshot !== snapshot);
        if (reset)
          response = searchResponse.parse(
            await command({
              op: 'content-search',
              query: input.query,
              type: input.type,
              offset: 0,
              hybrid: input.mode === 'HYBRID',
            }),
          );
        signal.throwIfAborted();
        if (revision !== this.revision()) throw new Error('CHANGED');
        return {
          result: contentLookupResultSchema.parse({
            scope: 'CURRENT_SAVED_DOCUMENTS',
            snapshot,
            reset,
            coverage: response.coverage,
            items: response.items.slice(0, 30),
            nextOffset:
              !response.coverage.pending && response.items.length > 30 ? (reset ? 0 : input.offset) + 30 : null,
          }),
        };
      });
    } catch (error) {
      if (
        input.mode === 'HYBRID' &&
        error instanceof Error &&
        ['NOT_CONFIGURED', 'UNAVAILABLE', 'GPU_UNAVAILABLE'].includes(error.message)
      )
        return this.lookupKeywords(input, error.message as 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'GPU_UNAVAILABLE');
      const parsed = imageSearchErrorSchema.safeParse(error instanceof Error ? error.message : 'UNAVAILABLE');
      return { error: parsed.success ? parsed.data : 'UNAVAILABLE' };
    }
  }
}
