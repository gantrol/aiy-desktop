import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { LibraryStorage } from '@/main/database/core/storage';
import type { GalleryRepository } from '@/main/database/assets/gallery-repository';
import type { AssetFileRepository } from '@/main/database/assets/asset-file-repository';
import { resolveImageSearchRuntime } from '@/main/image-search/runtime';
import { ImageSearchWorker } from '@/main/image-search/worker-client';
import type { ImageSearchCommand } from '@/main/image-search/worker-protocol';
import { disposeImageInputService, imageInputService } from '@/main/image-search/input-service';
import type { PreparedImage } from '@/main/image-search/input-policy';
import {
  imageSearchErrorSchema,
  imageSearchItemSchema,
  imageSearchResultSchema,
  type ImageSearchInput,
  type ImageSearchResponse,
  type ImageSearchExecution,
} from '@/shared/contracts/image-search';

const workerResponse = z.union([z.object({ value: z.unknown() }), z.object({ error: z.literal('UNAVAILABLE') })]);
const pendingSchema = z.array(z.object({ id: z.string(), hash: z.string() })).max(4);
const searchResponse = z.object({
  items: z.array(imageSearchItemSchema).max(31),
  coverage: imageSearchResultSchema.shape.coverage,
  generation: z.number().default(0),
  visualPending: z.number().optional(),
  warning: imageSearchResultSchema.shape.warning,
  channels: imageSearchResultSchema.shape.channels,
  affected: imageSearchResultSchema.shape.affected,
});

interface SearchTask {
  id: string;
  input: ImageSearchInput;
  configurationPath: string;
  controller: AbortController;
  resolve(response: ImageSearchResponse): void;
}

export class ImageSearchService {
  private worker: ImageSearchWorker | null = null;
  private indexWorker: ImageSearchWorker | null = null;
  private indexing: { id: string; controller: AbortController } | null = null;
  private fingerprint = '';
  private catalogs = new WeakMap<ImageSearchWorker, string>();
  private generation = 0;
  private current: SearchTask | null = null;
  private queued: SearchTask | null = null;
  private scheduled: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private indexLease: string | null = null;
  private disposed = false;
  private indexError: 'UNAVAILABLE' | 'GPU_UNAVAILABLE' | null = null;
  private visualPending = 0;

  constructor(
    private storage: LibraryStorage,
    private gallery: GalleryRepository,
    private assets: AssetFileRepository,
  ) {}

  cancel(requestId: string) {
    if (this.indexLease === requestId) this.indexLease = null;
    if (this.scheduled?.id === requestId) this.cancelScheduled();
    if (this.current?.id === requestId) this.current.controller.abort(new Error('CANCELLED'));
    if (this.indexing?.id === requestId) this.indexing.controller.abort(new Error('CANCELLED'));
    if (this.queued?.id === requestId) {
      this.queued.resolve({ error: 'CANCELLED' });
      this.queued = null;
    }
  }

  inspect(assetId: string) {
    return !this.disposed && this.gallery.listImageSearchSources('', [assetId], false).length === 1;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    disposeImageInputService(this.storage);
  }

  stop() {
    this.indexLease = null;
    this.cancelScheduled();
    this.current?.controller.abort(new Error('CANCELLED'));
    this.queued?.resolve({ error: 'CANCELLED' });
    this.queued = null;
    this.worker?.stop();
    this.indexing?.controller.abort(new Error('CANCELLED'));
    this.indexWorker?.stop();
  }

  async lookup(input: ImageSearchInput, configurationPath: string): Promise<ImageSearchResponse> {
    if (this.disposed) return { error: 'CANCELLED' };
    this.cancelScheduled();
    this.indexLease = input.advanceIndex ? input.requestId : null;
    if (this.indexing) this.indexing.id = input.requestId;
    if (!input.advanceIndex) this.indexing?.controller.abort(new Error('CANCELLED'));
    return new Promise((resolve) => {
      const task = { id: input.requestId, input, configurationPath, resolve, controller: new AbortController() };
      if (this.current) {
        // One active query plus only the latest waiting query; indexing has its own worker.
        this.current.controller.abort(new Error('CANCELLED'));
        this.queued?.resolve({ error: 'CANCELLED' });
        this.queued = task;
      } else void this.execute(task);
    });
  }

  private async execute(current: SearchTask) {
    this.current = current;
    try {
      const runtime = await resolveImageSearchRuntime(current.configurationPath);
      current.controller.signal.throwIfAborted();
      const runtimeKey = `${runtime.fingerprint}:${runtime.device}`;
      if (!this.worker || runtimeKey !== this.fingerprint) {
        this.worker?.stop();
        this.indexing?.controller.abort(new Error('CANCELLED'));
        this.indexWorker?.stop();
        const cachePath = path.join(this.storage.libraryRoot, '.cache', 'image-search', 'vectors.sqlite3');
        this.worker = new ImageSearchWorker(runtime, cachePath, 'search');
        this.indexWorker = new ImageSearchWorker(runtime, cachePath, 'index');
        this.fingerprint = runtimeKey;
        this.catalogs = new WeakMap();
        this.indexError = null;
      }
      const result = await this.run(current.input, current.controller.signal);
      current.resolve({ result });
      if (this.indexLease === current.id && this.visualPending && !this.indexError) this.scheduleIndex(current.id);
    } catch (error) {
      if (this.indexLease === current.id) this.indexLease = null;
      this.indexing?.controller.abort(new Error('CANCELLED'));
      const code = imageSearchErrorSchema.safeParse(error instanceof Error ? error.message : 'UNAVAILABLE');
      current.resolve({ error: code.success ? code.data : 'UNAVAILABLE' });
    } finally {
      if (this.current === current) this.current = null;
      const next = this.queued;
      this.queued = null;
      if (next && !this.disposed) void this.execute(next);
    }
  }

  private revision() {
    return `${this.storage.getChangeRevision()}:${this.storage.db.pragma('data_version', { simple: true })}`;
  }

  private cancelScheduled() {
    if (this.scheduled) clearTimeout(this.scheduled.timer);
    this.scheduled = null;
  }

  get execution(): { search: ImageSearchExecution; index: ImageSearchExecution } {
    return {
      search: this.worker?.execution ?? { backend: null, fallback: false },
      index: this.indexWorker?.execution ?? { backend: null, fallback: false },
    };
  }

  private scheduleIndex(id: string) {
    this.cancelScheduled();
    const timer = setTimeout(() => {
      this.scheduled = null;
      if (this.indexLease !== id || this.disposed || this.indexError) return;
      if (this.current) this.scheduleIndex(id);
      else if (!this.indexing) void this.index(id);
    }, 50);
    timer.unref();
    this.scheduled = { id, timer };
  }

  private async index(id: string) {
    const worker = this.indexWorker!;
    const task = { id, controller: new AbortController() };
    this.indexing = task;
    let remaining = false;
    try {
      await this.synchronize(this.revision(), task.controller.signal, worker);
      await this.advance(task.controller.signal, worker);
      // Release the larger vision model as soon as the current backlog is complete.
      remaining = pendingSchema.parse(await this.command({ op: 'pending' }, task.controller.signal, worker)).length > 0;
      if (!remaining) worker.stop();
    } catch (error) {
      if (
        worker === this.indexWorker &&
        !task.controller.signal.aborted &&
        !(error instanceof Error && error.message === 'CHANGED')
      )
        this.indexError =
          error instanceof Error && error.message === 'GPU_UNAVAILABLE' ? 'GPU_UNAVAILABLE' : 'UNAVAILABLE';
      // A new query may take over the lease while an old image finishes its cancellable boundary.
      remaining = task.controller.signal.aborted || (error instanceof Error && error.message === 'CHANGED');
    } finally {
      if (this.indexing === task) this.indexing = null;
      this.generation++;
      if (remaining && this.indexLease && !this.disposed && !this.indexError) this.scheduleIndex(this.indexLease);
    }
  }

  private async command(command: ImageSearchCommand, signal: AbortSignal, worker = this.worker!) {
    const response = workerResponse.parse(await worker.request(command, signal));
    if ('error' in response) throw new Error(response.error);
    return response.value;
  }

  private async synchronize(revision: string, signal: AbortSignal, worker = this.worker!) {
    if (this.catalogs.get(worker) === `${revision}:${worker.generation}`) return;
    this.catalogs.delete(worker);
    await this.command({ op: 'sync-start' }, signal, worker);
    let after = '';
    for (;;) {
      signal.throwIfAborted();
      const items = this.gallery.listImageSearchSources(after, undefined, worker === this.worker);
      if (!items.length) break;
      await this.command({ op: 'sync', items }, signal, worker);
      after = items.at(-1)!.id;
    }
    if (this.revision() !== revision) throw new Error('CHANGED');
    await this.command({ op: 'sync-finish' }, signal, worker);
    this.catalogs.set(worker, `${revision}:${worker.generation}`);
    this.generation++;
  }

  private async advance(signal: AbortSignal, worker: ImageSearchWorker) {
    const pending = pendingSchema.parse(await this.command({ op: 'pending' }, signal, worker)).slice(0, 1);
    if (!pending.length) return;
    const { files, failures } = await this.assets.resolveForSearch(pending.map((item) => item.id));
    signal.throwIfAborted();
    for (const candidate of pending) {
      const file = files.get(candidate.id);
      if (file && file.objectHash !== candidate.hash) throw new Error('CHANGED');
      const prepared: PreparedImage = file
        ? await imageInputService(this.storage).prepare(file, 'visual', signal)
        : { failure: failures.get(candidate.id) ?? { reason: 'SOURCE_UNREADABLE', stage: 'source' } };
      signal.throwIfAborted();
      const encoded =
        'failure' in prepared
          ? { vector: null }
          : z
              .object({
                vector: z.array(z.number().finite()).length(768).nullable(),
              })
              .parse(
                await this.command(
                  { op: 'index', items: [{ ...candidate, path: prepared.path }], missing: [] },
                  signal,
                  worker,
                ),
              );
      // Inference can finish after deletion or replacement. Only main can recheck the live catalog.
      const current = this.gallery.listImageSearchSources('', [candidate.id], false)[0];
      signal.throwIfAborted();
      if (!current || current.hash !== candidate.hash) throw new Error('CHANGED');
      await this.command(
        {
          op: 'commit-image',
          ...candidate,
          vector: encoded.vector,
          ...('failure' in prepared ? { failure: prepared.failure, limited: false } : { limited: prepared.limited }),
        },
        signal,
        worker,
      );
    }
  }

  private async run(input: ImageSearchInput, signal: AbortSignal) {
    const revision = this.revision();
    await this.synchronize(revision, signal);
    if (input.retryUnavailable) {
      this.indexError = null;
      await this.command({ op: 'retry' }, signal);
    }
    const queryHash = createHash('sha256')
      .update(JSON.stringify([input.query, input.mode]))
      .digest('hex');
    let response = searchResponse.parse(
      await this.command(
        { op: 'search', query: input.query, offset: input.offset, hybrid: input.mode === 'HYBRID' },
        signal,
      ),
    );
    let snapshot = `${revision}:${this.generation}:${response.generation}:${queryHash}`;
    const reset = Boolean(input.offset && input.snapshot !== snapshot);
    const offset = reset ? 0 : input.offset;
    if (reset) {
      response = searchResponse.parse(
        await this.command({ op: 'search', query: input.query, offset, hybrid: input.mode === 'HYBRID' }, signal),
      );
      snapshot = `${revision}:${this.generation}:${response.generation}:${queryHash}`;
    }
    this.visualPending = response.visualPending ?? response.coverage.pending;
    signal.throwIfAborted();
    if (this.revision() !== revision) {
      this.catalogs.delete(this.worker!);
      throw new Error('CHANGED');
    }
    // Resolve visibility again after inference, before returning IDs to the renderer.
    const visible = new Set(
      this.gallery
        .listImageSearchSources(
          '',
          response.items.map((item) => item.id),
          false,
        )
        .map((item) => item.id),
    );
    const items = response.items.filter((item) => visible.has(item.id));
    return imageSearchResultSchema.parse({
      snapshot,
      reset,
      indexError: this.indexError,
      warning: response.warning,
      coverage: response.coverage,
      channels: response.channels,
      affected: response.affected,
      items: items.slice(0, 30),
      nextOffset: !response.coverage.pending && items.length > 30 ? offset + 30 : null,
    });
  }
}
