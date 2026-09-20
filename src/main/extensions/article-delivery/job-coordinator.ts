import { selectedWatermarkProfile, type NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import type { LibraryDatabase } from '@/main/database';
import { ArticleDeliveryConnections } from '@/main/extensions/article-delivery/connection';
import {
  assertArticleDeliveryExtensionActivated,
  resolveArticleDeliveryDefinition,
} from '@/main/extensions/article-delivery/definition';
import { ArticleDeliveryService } from '@/main/extensions/article-delivery/service';
import {
  ArticleDeliveryUploadLifecycle,
  waitForUploadPreparation,
} from '@/main/extensions/article-delivery/upload-lifecycle';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import {
  articleDeliveryJobChangedEventSchema,
  articleDeliveryMode,
  articleDeliveryJobListInputSchema,
  articleDeliveryJobRetryInputSchema,
  articleDeliveryUploadInputSchema,
  type ArticleDeliveryJob,
  type ArticleDeliveryJobChangedEvent,
  type ArticleDeliveryJobListInput,
  type ArticleDeliveryJobRetryInput,
  type ArticleDeliveryUploadInput,
  type ArticleDeliveryProgress,
} from '@/shared/contracts/article-delivery';

type ArticleDeliveryJobDatabase = Pick<
  LibraryDatabase,
  | 'completeArticleDeliveryJob'
  | 'enqueueArticleDeliveryJob'
  | 'failArticleDeliveryJob'
  | 'getArticle'
  | 'getArticleRevision'
  | 'contentLibrary'
  | 'libraryRoot'
  | 'listArticleDeliveryJobs'
  | 'markArticleDeliveryJobRunning'
  | 'nextQueuedArticleDeliveryJob'
  | 'resolveAssetFilesAsync'
  | 'retryArticleDeliveryJob'
>;

type ArticleDeliveryFailureDetail = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

function deliveryFailure(reason: unknown) {
  const detail = (reason ?? {}) as ArticleDeliveryFailureDetail;
  const message = reason instanceof Error ? reason.message : String(reason);
  const code = typeof detail.code === 'string' && detail.code.trim() ? detail.code.trim() : 'DELIVERY_FAILED';
  const status = Number(detail.status);
  const retryable =
    (Number.isSafeInteger(status) && status >= 500) ||
    ['DELIVERY_INTERRUPTED', 'INTERNAL_ERROR', 'NETWORK_ERROR', 'TIMEOUT'].includes(code) ||
    /aborted|fetch failed|network|temporar|timed?\s*out|timeout/i.test(message);
  return { code, message, retryable };
}

export class ArticleDeliveryJobCoordinator {
  private started = false;
  private active: Promise<void> | null = null;
  private readonly uploads = new ArticleDeliveryUploadLifecycle();

  constructor(
    private readonly database: ArticleDeliveryJobDatabase,
    private readonly extensions: Pick<ExtensionRegistry, 'get' | 'isActivated' | 'isPermissionGranted'>,
    private readonly connections: ArticleDeliveryConnections,
    private readonly acquireOperation: () => () => void,
    private readonly onChanged: (event: ArticleDeliveryJobChangedEvent) => void,
    private readonly naturalWatermark?: NaturalWatermarkRuntime,
  ) {}

  async enqueue(rawInput: ArticleDeliveryUploadInput) {
    const input = articleDeliveryUploadInputSchema.parse(rawInput);
    const prepared = await this.prepareEnqueue(input).catch((reason: unknown) => {
      const code = (reason as ArticleDeliveryFailureDetail | null)?.code;
      throw Object.assign(new Error(reason instanceof Error ? reason.message : String(reason), { cause: reason }), {
        code: typeof code === 'string' && code.trim() ? code.trim() : 'DELIVERY_ADMISSION_REJECTED',
        admissionRejected: true,
      });
    });
    // Errors from this point may follow a durable insert; their admission result is unknown.
    const job = this.database.enqueueArticleDeliveryJob(prepared);
    this.emit(job);
    this.kick();
    return job;
  }

  private async prepareEnqueue(input: ArticleDeliveryUploadInput) {
    const article = this.database.getArticle(input.articleId);
    if (article.revisionId !== input.expectedRevisionId) throw new Error('Article revision changed before delivery');
    assertArticleDeliveryExtensionActivated(this.extensions, input.extensionId);
    const definition = resolveArticleDeliveryDefinition(this.extensions, input);
    const deliveryMode = articleDeliveryMode(definition.configuration);
    if (input.expectedDeliveryMode && input.expectedDeliveryMode !== deliveryMode) {
      throw Object.assign(new Error('DELIVERY_MODE_CHANGED'), { code: 'DELIVERY_MODE_CHANGED' });
    }
    const connection = await this.connections.get(input.extensionId);
    const delivery = new ArticleDeliveryService(
      this.database,
      this.extensions,
      connection,
      definition,
      undefined,
      this.naturalWatermark,
    );
    const status = delivery.status({
      extensionId: input.extensionId,
      channelId: input.channelId,
      spaceId: input.spaceId,
      articleId: input.articleId,
    });
    if (status.connection.state !== 'READY') throw new Error(status.connection.message);
    if (!status.profile) throw new Error('Article delivery target is not configured');
    if (
      input.expectedProfile &&
      (input.expectedProfile.slug !== status.profile.slug ||
        input.expectedProfile.description !== status.profile.description)
    ) {
      throw Object.assign(new Error('DELIVERY_PROFILE_CHANGED'), { code: 'DELIVERY_PROFILE_CHANGED' });
    }
    return {
      extensionId: input.extensionId,
      channelId: input.channelId,
      spaceId: input.spaceId,
      articleId: input.articleId,
      articleRevisionId: article.revisionId,
      articleContentHash: article.contentHash,
      targetSlug: status.profile.slug,
      targetDescription: status.profile.description,
      deliveryMode,
      watermarkProfile: await selectedWatermarkProfile(input.watermark, this.naturalWatermark),
      imagePreparation: input.imagePreparation ?? ({ version: 1, mode: 'BALANCED' } as const),
    };
  }

  list(rawInput: ArticleDeliveryJobListInput) {
    return this.database.listArticleDeliveryJobs(articleDeliveryJobListInputSchema.parse(rawInput));
  }

  retry(rawInput: ArticleDeliveryJobRetryInput) {
    const input = articleDeliveryJobRetryInputSchema.parse(rawInput);
    const job = this.database.retryArticleDeliveryJob(input.jobId);
    this.emit(job);
    this.kick();
    return job;
  }

  start() {
    if (this.started) return;
    this.resumeUploads();
    this.started = true;
    this.kick();
  }

  get isStarted() {
    return this.started;
  }

  acquireUpload() {
    return this.uploads.acquire();
  }

  resumeUploads() {
    this.uploads.resume();
  }

  async stopAndDrain() {
    this.started = false;
    const uploadsStopped = this.uploads.stopAndDrain();
    await Promise.all([uploadsStopped, this.active]);
  }

  private kick() {
    if (!this.started || this.active) return;
    this.active = this.pump()
      .catch((reason) => {
        console.error('[article-delivery] background queue failed', reason);
      })
      .finally(() => {
        this.active = null;
        if (this.started && this.database.nextQueuedArticleDeliveryJob()) this.kick();
      });
  }

  private async pump() {
    while (this.started) {
      const queued = this.database.nextQueuedArticleDeliveryJob();
      if (!queued) return;
      let release: (() => void) | null = null;
      try {
        release = this.acquireOperation();
      } catch {
        return;
      }
      try {
        const running = this.database.markArticleDeliveryJobRunning(queued.id);
        if (!running) continue;
        const upload = this.acquireUpload();
        try {
          this.emit(running);
          const result = await this.execute(running, upload.signal);
          // A valid receipt remains successful even if stopping raced with its completion.
          this.emit(this.database.completeArticleDeliveryJob(running.id, result));
        } catch (reason) {
          this.emit(this.database.failArticleDeliveryJob(running.id, deliveryFailure(reason)));
        } finally {
          upload.release();
        }
      } finally {
        release();
      }
    }
  }

  private async execute(job: ArticleDeliveryJob, signal: AbortSignal) {
    signal.throwIfAborted();
    const definition = resolveArticleDeliveryDefinition(this.extensions, job);
    const connection = await waitForUploadPreparation(this.connections.get(job.extensionId), signal);
    signal.throwIfAborted();
    const delivery = new ArticleDeliveryService(
      this.database,
      this.extensions,
      connection,
      definition,
      undefined,
      this.naturalWatermark,
    );
    return delivery.uploadRevision(
      {
        extensionId: job.extensionId,
        channelId: job.channelId,
        spaceId: job.spaceId,
        articleId: job.articleId,
        expectedRevisionId: job.articleRevisionId,
        expectedDeliveryMode: job.deliveryMode,
        imagePreparation: job.imagePreparation ?? { version: 1, mode: 'ORIGINAL' },
      },
      { slug: job.targetSlug, description: job.targetDescription },
      job.articleContentHash,
      (progress) => this.emit(job, progress),
      job.watermarkProfile ?? null,
      signal,
    );
  }

  private emit(job: ArticleDeliveryJob, progress?: ArticleDeliveryProgress) {
    this.onChanged(articleDeliveryJobChangedEventSchema.parse({ job, progress }));
  }
}
