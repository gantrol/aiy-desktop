import { createHash } from 'node:crypto';
import path from 'node:path';
import type { LibraryStorage } from '@/main/database/core/storage';
import type { GalleryRepository } from '@/main/database/assets/gallery-repository';
import type { AssetFileRepository } from '@/main/database/assets/asset-file-repository';
import { ImageSearchWorker } from '@/main/image-search/worker-client';
import { SearchRequestQueue } from '@/main/image-search/request-queue';
import {
  imageSearchErrorSchema,
  imageSearchResultSchema,
  type ImageSearchInput,
  type ImageSearchResponse,
} from '@/shared/contracts/image-search';
import type { ImageSearchCommand } from '@/main/image-search/worker-protocol';
import { z } from 'zod';
import { contentSearchQuery } from '@/shared/content-search-query';
import { imageInputService } from '@/main/image-search/input-service';
import type { PreparedImage } from '@/main/image-search/input-policy';
import {
  imageIssueResultSchema,
  type ImageIssueInput,
  type ImageInputFailure,
} from '@/shared/contracts/image-search-issues';

/** Filename/title matching is available without the optional model or plugin. */
export class ImageMetadataSearch {
  private readonly queue = new SearchRequestQueue();
  private readonly detailsQueue = new SearchRequestQueue();
  private readonly worker: ImageSearchWorker;
  private catalog = '';
  private readonly ocrWorker: ImageSearchWorker;
  private ocrCatalog = '';
  private lease: string | null = null;
  private task: { id: string; controller: AbortController } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private readonly detailsWorker: ImageSearchWorker;

  constructor(
    private storage: LibraryStorage,
    private gallery: GalleryRepository,
    private assets: AssetFileRepository,
  ) {
    this.worker = new ImageSearchWorker(
      { model: '', fingerprint: 'image-metadata-v1', device: 'CPU' },
      path.join(storage.libraryRoot, '.cache', 'image-search', 'vectors.sqlite3'),
      'search',
    );
    this.ocrWorker = new ImageSearchWorker(
      { model: '', fingerprint: 'image-metadata-v1', device: 'CPU' },
      path.join(storage.libraryRoot, '.cache', 'image-search', 'vectors.sqlite3'),
      'index',
    );
    this.detailsWorker = new ImageSearchWorker(
      { model: '', fingerprint: 'image-metadata-v1', device: 'CPU' },
      path.join(storage.libraryRoot, '.cache', 'image-search', 'vectors.sqlite3'),
      'index',
    );
  }

  cancel(id: string) {
    this.queue.cancel(id);
    this.detailsQueue.cancel(id);
    if (this.lease === id) {
      this.lease = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.task?.id === id) this.task.controller.abort(new Error('CANCELLED'));
  }
  stop() {
    this.queue.stop();
    this.detailsQueue.stop();
    this.worker.stop();
    this.lease = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.task?.controller.abort(new Error('CANCELLED'));
    this.ocrWorker.stop();
    this.detailsWorker.stop();
  }

  private revision() {
    return `${this.storage.getChangeRevision()}:${this.storage.db.pragma('data_version', { simple: true })}`;
  }

  private scheduleOcr() {
    if (!this.lease || this.timer || this.task || this.failed || process.platform !== 'win32') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.lease) void this.advanceOcr(this.lease);
    }, 50);
    this.timer.unref();
  }

  private async advanceOcr(id: string) {
    const task = { id, controller: new AbortController() };
    this.task = task;
    const { signal } = task.controller;
    let remaining = false;
    const command = async (value: ImageSearchCommand) =>
      z.object({ value: z.unknown() }).parse(await this.ocrWorker.request(value, signal)).value;
    try {
      const revision = this.revision();
      if (this.ocrCatalog !== `${revision}:${this.ocrWorker.generation}`) {
        this.ocrCatalog = '';
        await command({ op: 'sync-start' });
        let after = '';
        for (;;) {
          signal.throwIfAborted();
          const items = this.gallery.listImageSearchSources(after, undefined, false);
          if (!items.length) break;
          await command({ op: 'sync', items });
          after = items.at(-1)!.id;
        }
        if (revision !== this.revision()) throw new Error('CHANGED');
        await command({ op: 'sync-finish' });
        this.ocrCatalog = `${revision}:${this.ocrWorker.generation}`;
      }
      const pendingSchema = z.array(z.object({ id: z.string(), hash: z.string() })).max(1);
      const pending = pendingSchema.parse(await command({ op: 'ocr-pending' }))[0];
      if (pending) {
        const { files, failures } = await this.assets.resolveForSearch([pending.id]);
        const file = files.get(pending.id);
        signal.throwIfAborted();
        if (file && file.objectHash !== pending.hash) throw new Error('CHANGED');
        const prepared: PreparedImage = file
          ? await imageInputService(this.storage).prepare(file, 'ocr', signal)
          : { failure: failures.get(pending.id) ?? { reason: 'SOURCE_UNREADABLE', stage: 'source' } };
        const result =
          'failure' in prepared
            ? { text: null, status: 'failed' }
            : z
                .object({
                  text: z.string().nullable(),
                  status: z.string(),
                })
                .parse(
                  await command({
                    op: 'ocr-index',
                    ...pending,
                    path: prepared.path,
                  }),
                );
        const current = this.gallery.listImageSearchSources('', [pending.id], false)[0];
        signal.throwIfAborted();
        if (!current || current.hash !== pending.hash) throw new Error('CHANGED');
        const failure: ImageInputFailure | undefined =
          'failure' in prepared
            ? prepared.failure
            : result.text !== null
              ? undefined
              : {
                  stage: 'ocr',
                  reason:
                    result.status === 'unavailable'
                      ? 'OCR_UNAVAILABLE'
                      : result.status === 'tooLarge'
                        ? 'DIMENSION_LIMIT'
                        : 'INDEX_FAILED',
                };
        await command({
          op: 'commit-ocr',
          ...pending,
          text: result.text,
          failure,
          limited: 'limited' in prepared && prepared.limited,
        });
      }
      remaining = pendingSchema.parse(await command({ op: 'ocr-pending' })).length > 0;
      if (!remaining) this.ocrWorker.stop();
    } catch (error) {
      remaining = signal.aborted || (error instanceof Error && error.message === 'CHANGED');
      if (!remaining) this.failed = true;
    } finally {
      if (this.task === task) this.task = null;
      if (remaining) this.scheduleOcr();
    }
  }

  async lookup(input: ImageSearchInput): Promise<ImageSearchResponse> {
    // Reading another page must not cancel the background OCR lease.
    if (input.advanceIndex || !input.offset) {
      this.lease = input.advanceIndex ? input.requestId : null;
      if (this.task && this.lease) this.task.id = this.lease;
      if (!input.advanceIndex) this.task?.controller.abort(new Error('CANCELLED'));
    }
    try {
      return await this.queue.run(input.requestId, async (signal) => {
        try {
          contentSearchQuery(input.query);
        } catch {
          throw new Error('INVALID_QUERY');
        }
        const revision = this.revision();
        const command = async (value: ImageSearchCommand) =>
          z.object({ value: z.unknown() }).parse(await this.worker.request(value, signal)).value;
        if (this.catalog !== `${revision}:${this.worker.generation}`) {
          this.catalog = '';
          await command({ op: 'sync-start' });
          let after = '';
          for (;;) {
            signal.throwIfAborted();
            const items = this.gallery.listImageSearchSources(after);
            if (!items.length) break;
            await command({ op: 'sync', items });
            after = items.at(-1)!.id;
          }
          if (revision !== this.revision()) throw new Error('CHANGED');
          await command({ op: 'sync-finish' });
          this.catalog = `${revision}:${this.worker.generation}`;
        }
        if (input.retryUnavailable) {
          this.failed = false;
          await command({ op: 'ocr-retry' });
        }
        const responseSchema = z.object({
          items: z.array(imageSearchResultSchema.shape.items.element).max(31),
          coverage: imageSearchResultSchema.shape.coverage,
          generation: z.number(),
          warning: imageSearchResultSchema.shape.warning,
          channels: imageSearchResultSchema.shape.channels,
          affected: imageSearchResultSchema.shape.affected,
        });
        let response = responseSchema.parse(
          await command({
            op: 'metadata-search',
            query: input.query,
            offset: input.offset,
            refresh: !input.snapshot || input.retryUnavailable,
          }),
        );
        const queryHash = createHash('sha256').update(input.query).digest('hex');
        let snapshot = `${revision}:${this.worker.generation}:${response.generation}:${queryHash}`;
        const reset = Boolean(input.offset && input.snapshot !== snapshot);
        const offset = reset ? 0 : input.offset;
        if (reset) {
          response = responseSchema.parse(await command({ op: 'metadata-search', query: input.query, offset }));
          snapshot = `${revision}:${this.worker.generation}:${response.generation}:${queryHash}`;
        }
        if (revision !== this.revision()) throw new Error('CHANGED');
        signal.throwIfAborted();
        if (response.coverage.pending) this.scheduleOcr();
        return {
          result: imageSearchResultSchema.parse({
            items: response.items.slice(0, 30),
            coverage: response.coverage,
            channels: response.channels,
            affected: response.affected,
            warning: response.warning,
            indexError: this.failed ? 'UNAVAILABLE' : null,
            snapshot,
            reset,
            nextOffset:
              (input.mode !== 'HYBRID' || !response.coverage.pending) && response.items.length > 30
                ? offset + 30
                : null,
          }),
        };
      });
    } catch (error) {
      this.cancel(input.requestId);
      const parsed = imageSearchErrorSchema.safeParse(error instanceof Error ? error.message : 'UNAVAILABLE');
      return { error: parsed.success ? parsed.data : 'UNAVAILABLE' };
    }
  }

  async issues(input: ImageIssueInput) {
    return this.detailsQueue.run(input.requestId, async (signal) => {
      const revision = this.revision();
      const command = async (value: ImageSearchCommand) =>
        z.object({ value: z.unknown() }).parse(await this.detailsWorker.request(value, signal)).value;
      // Independent visible set: opening details never mutates the search worker's catalog or lease.
      await command({ op: 'sync-start' });
      let after = '';
      for (;;) {
        signal.throwIfAborted();
        const items = this.gallery.listImageSearchSources(after, undefined, false);
        if (!items.length) break;
        await command({ op: 'sync', items });
        after = items.at(-1)!.id;
      }
      const read = async (cursor: string) =>
        z
          .object({
            items: imageIssueResultSchema.shape.items,
            next: imageIssueResultSchema.shape.next,
            generation: z.number(),
          })
          .parse(await command({ op: 'issues', channel: input.channel, after: cursor }));
      let result = await read(input.after);
      let snapshot = `${revision}:${this.detailsWorker.generation}:${result.generation}:${input.channel}`;
      const reset = Boolean(input.after && input.snapshot !== snapshot);
      if (reset) {
        result = await read('');
        snapshot = `${revision}:${this.detailsWorker.generation}:${result.generation}:${input.channel}`;
      }
      if (revision !== this.revision()) throw new Error('CHANGED');
      const active = new Set(
        this.gallery
          .listImageSearchSources(
            '',
            result.items.map((item) => item.id),
            false,
          )
          .map((item) => item.id),
      );
      return imageIssueResultSchema.parse({
        items: result.items.filter((item) => active.has(item.id)),
        next: result.next,
        snapshot,
        reset,
      });
    });
  }
}
