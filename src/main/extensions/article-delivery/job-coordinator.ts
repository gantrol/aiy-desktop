import type { LibraryDatabase } from '@/main/database';
import { ArticleDeliveryConnections } from '@/main/extensions/article-delivery/connection';
import {
  assertArticleDeliveryExtensionActivated,
  resolveArticleDeliveryDefinition,
} from '@/main/extensions/article-delivery/definition';
import { ArticleDeliveryService } from '@/main/extensions/article-delivery/service';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import {
  articleDeliveryJobChangedEventSchema,
  articleDeliveryJobListInputSchema,
  articleDeliveryJobRetryInputSchema,
  articleDeliveryUploadInputSchema,
  type ArticleDeliveryJob,
  type ArticleDeliveryJobChangedEvent,
  type ArticleDeliveryJobListInput,
  type ArticleDeliveryJobRetryInput,
  type ArticleDeliveryUploadInput,
} from '@/shared/contracts/article-delivery';

type ArticleDeliveryJobDatabase = Pick<
  LibraryDatabase,
  | 'completeArticleDeliveryJob'
  | 'enqueueArticleDeliveryJob'
  | 'failArticleDeliveryJob'
  | 'getArticle'
  | 'getArticleRevision'
  | 'listArticleDeliveryJobs'
  | 'markArticleDeliveryJobRunning'
  | 'nextQueuedArticleDeliveryJob'
  | 'resolveAssetFile'
  | 'retryArticleDeliveryJob'
>;

type ArticleDeliveryFailureDetail = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

function deliveryFailure(reason: unknown) {
  const detail = reason as ArticleDeliveryFailureDetail;
  const message = reason instanceof Error ? reason.message : String(reason);
  const code = typeof detail.code === 'string' && detail.code.trim() ? detail.code.trim() : 'DELIVERY_FAILED';
  const status = Number(detail.status);
  const retryable =
    (Number.isSafeInteger(status) && status >= 500) ||
    ['INTERNAL_ERROR', 'NETWORK_ERROR', 'TIMEOUT'].includes(code) ||
    /aborted|fetch failed|network|temporar|timed?\s*out|timeout/i.test(message);
  return { code, message, retryable };
}

export class ArticleDeliveryJobCoordinator {
  private started = false;
  private active: Promise<void> | null = null;

  constructor(
    private readonly database: ArticleDeliveryJobDatabase,
    private readonly extensions: Pick<ExtensionRegistry, 'get' | 'isActivated' | 'isPermissionGranted'>,
    private readonly connections: ArticleDeliveryConnections,
    private readonly acquireOperation: () => () => void,
    private readonly onChanged: (event: ArticleDeliveryJobChangedEvent) => void,
  ) {}

  async enqueue(rawInput: ArticleDeliveryUploadInput) {
    const input = articleDeliveryUploadInputSchema.parse(rawInput);
    const article = this.database.getArticle(input.articleId);
    if (article.revisionId !== input.expectedRevisionId) throw new Error('Article revision changed before delivery');
    assertArticleDeliveryExtensionActivated(this.extensions, input.extensionId);
    const definition = resolveArticleDeliveryDefinition(this.extensions, input);
    const connection = await this.connections.get(input.extensionId);
    const delivery = new ArticleDeliveryService(this.database, this.extensions, connection, definition);
    const status = delivery.status({
      extensionId: input.extensionId,
      channelId: input.channelId,
      spaceId: input.spaceId,
      articleId: input.articleId,
    });
    if (status.connection.state !== 'READY') throw new Error(status.connection.message);
    if (!status.profile) throw new Error('Article delivery target is not configured');
    const job = this.database.enqueueArticleDeliveryJob({
      extensionId: input.extensionId,
      channelId: input.channelId,
      spaceId: input.spaceId,
      articleId: input.articleId,
      articleRevisionId: article.revisionId,
      articleContentHash: article.contentHash,
      targetSlug: status.profile.slug,
      targetDescription: status.profile.description,
    });
    this.emit(job);
    this.kick();
    return job;
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
    this.started = true;
    this.kick();
  }

  async stopAndDrain() {
    this.started = false;
    await this.active;
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
        this.emit(running);
        try {
          const result = await this.execute(running);
          this.emit(this.database.completeArticleDeliveryJob(running.id, result));
        } catch (reason) {
          this.emit(this.database.failArticleDeliveryJob(running.id, deliveryFailure(reason)));
        }
      } finally {
        release();
      }
    }
  }

  private async execute(job: ArticleDeliveryJob) {
    const definition = resolveArticleDeliveryDefinition(this.extensions, job);
    const connection = await this.connections.get(job.extensionId);
    const delivery = new ArticleDeliveryService(this.database, this.extensions, connection, definition);
    return delivery.uploadRevision(
      {
        extensionId: job.extensionId,
        channelId: job.channelId,
        spaceId: job.spaceId,
        articleId: job.articleId,
        expectedRevisionId: job.articleRevisionId,
      },
      { slug: job.targetSlug, description: job.targetDescription },
      job.articleContentHash,
    );
  }

  private emit(job: ArticleDeliveryJob) {
    this.onChanged(articleDeliveryJobChangedEventSchema.parse({ job }));
  }
}
