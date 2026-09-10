import { naturalWatermarkProfileSchema, type NaturalWatermarkProfile } from '@/shared/contracts/natural-watermark';
import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import {
  articleDeliveryJobListInputSchema,
  articleDeliveryJobSchema,
  articleDeliveryUploadResultSchema,
  type ArticleDeliveryJob,
  type ArticleDeliveryJobListInput,
  type ArticleDeliveryUploadResult,
} from '@/shared/contracts/article-delivery';

export type ArticleDeliveryJobCreateInput = {
  extensionId: string;
  channelId: string;
  spaceId: string;
  articleId: string;
  articleRevisionId: string;
  articleContentHash: string;
  targetSlug: string;
  targetDescription: string;
  watermarkProfile?: NaturalWatermarkProfile | null;
  retryOfJobId?: string | null;
};

export type ArticleDeliveryJobFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

function nullableText(value: unknown) {
  return value == null ? null : text(value) || null;
}

function storedResult(value: unknown): ArticleDeliveryUploadResult | null {
  if (value == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(value)) as unknown;
  } catch {
    throw new Error('Stored article delivery result is invalid');
  }
  return articleDeliveryUploadResultSchema.parse(parsed);
}

function jobDto(row: JsonMap): ArticleDeliveryJob {
  return articleDeliveryJobSchema.parse({
    id: text(row.id),
    extensionId: text(row.extension_id),
    channelId: text(row.channel_id),
    spaceId: text(row.space_id),
    articleId: text(row.article_id),
    articleRevisionId: text(row.article_revision_id),
    articleContentHash: text(row.article_content_hash),
    targetSlug: text(row.target_slug),
    targetDescription: text(row.target_description),
    watermarkProfile:
      row.watermark_profile_json == null
        ? null
        : naturalWatermarkProfileSchema.parse(JSON.parse(text(row.watermark_profile_json))),
    status: text(row.status),
    attemptCount: Number(row.attempt_count),
    result: storedResult(row.result_json),
    errorCode: nullableText(row.error_code),
    errorMessage: nullableText(row.error_message),
    retryable: Number(row.retryable) === 1,
    retryOfJobId: nullableText(row.retry_of_job_id),
    createdAt: text(row.created_at),
    startedAt: nullableText(row.started_at),
    completedAt: nullableText(row.completed_at),
    updatedAt: text(row.updated_at),
  });
}

export class ArticleDeliveryJobRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  enqueue(input: ArticleDeliveryJobCreateInput): ArticleDeliveryJob {
    const active = this.db
      .prepare(
        `SELECT * FROM article_delivery_jobs
        WHERE extension_id = ? AND channel_id = ? AND space_id = ? AND article_id = ?
          AND article_revision_id = ? AND watermark_profile_json IS ? AND status IN ('QUEUED', 'RUNNING')
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(
        input.extensionId,
        input.channelId,
        input.spaceId,
        input.articleId,
        input.articleRevisionId,
        input.watermarkProfile ? JSON.stringify(naturalWatermarkProfileSchema.parse(input.watermarkProfile)) : null,
      ) as JsonMap | undefined;
    if (active) return jobDto(active);
    return this.insert(input);
  }

  list(rawInput: ArticleDeliveryJobListInput): ArticleDeliveryJob[] {
    const input = articleDeliveryJobListInputSchema.parse(rawInput);
    if (!input.articleId) {
      const rows = this.db
        .prepare(
          `SELECT job.* FROM article_delivery_jobs job
          JOIN articles article ON article.id = job.article_id AND article.deleted_at IS NULL
          WHERE job.space_id = ? AND (
            job.status IN ('QUEUED', 'RUNNING') OR NOT EXISTS (
              SELECT 1 FROM article_delivery_jobs newer
              WHERE newer.space_id = job.space_id AND newer.article_id = job.article_id
                AND newer.extension_id = job.extension_id AND newer.channel_id = job.channel_id
                AND (newer.created_at > job.created_at OR (newer.created_at = job.created_at AND newer.id > job.id))
            )
          )
          ORDER BY CASE WHEN job.status IN ('QUEUED', 'RUNNING') THEN 0 WHEN job.status = 'FAILED' THEN 1 ELSE 2 END,
            job.created_at DESC, job.id DESC LIMIT ?`,
        )
        .all(input.spaceId, input.limit) as JsonMap[];
      return rows.map(jobDto);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM article_delivery_jobs
        WHERE space_id = ? AND article_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(input.spaceId, input.articleId, input.limit) as JsonMap[];
    return rows.map(jobDto);
  }

  nextQueued(): ArticleDeliveryJob | null {
    const row = this.db
      .prepare("SELECT * FROM article_delivery_jobs WHERE status = 'QUEUED' ORDER BY created_at, id LIMIT 1")
      .get() as JsonMap | undefined;
    return row ? jobDto(row) : null;
  }

  markRunning(jobId: string): ArticleDeliveryJob | null {
    return this.db.transaction(() => {
      const timestamp = now();
      const result = this.db
        .prepare(
          `UPDATE article_delivery_jobs
          SET status = 'RUNNING', attempt_count = attempt_count + 1, result_json = NULL,
            error_code = NULL, error_message = NULL, retryable = 0,
            started_at = ?, completed_at = NULL, updated_at = ?
          WHERE id = ? AND status = 'QUEUED'`,
        )
        .run(timestamp, timestamp, jobId);
      if (result.changes !== 1) return null;
      return this.require(jobId);
    })();
  }

  succeed(jobId: string, result: ArticleDeliveryUploadResult): ArticleDeliveryJob {
    const parsed = articleDeliveryUploadResultSchema.parse(result);
    const timestamp = now();
    const update = this.db
      .prepare(
        `UPDATE article_delivery_jobs
        SET status = 'SUCCEEDED', result_json = ?, error_code = NULL, error_message = NULL,
          retryable = 0, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(JSON.stringify(parsed), timestamp, timestamp, jobId);
    if (update.changes !== 1) throw new Error('Article delivery job is no longer running');
    const job = this.require(jobId);
    this.record(job, 'SUCCEED');
    return job;
  }

  fail(jobId: string, failure: ArticleDeliveryJobFailure): ArticleDeliveryJob {
    const timestamp = now();
    const update = this.db
      .prepare(
        `UPDATE article_delivery_jobs
        SET status = 'FAILED', result_json = NULL, error_code = ?, error_message = ?, retryable = ?,
          completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(
        failure.code.slice(0, 160),
        failure.message.slice(0, 1_000),
        failure.retryable ? 1 : 0,
        timestamp,
        timestamp,
        jobId,
      );
    if (update.changes !== 1) throw new Error('Article delivery job is no longer running');
    const job = this.require(jobId);
    this.record(job, 'FAIL');
    return job;
  }

  retry(jobId: string): ArticleDeliveryJob {
    return this.db.transaction(() => {
      const source = this.db.prepare('SELECT * FROM article_delivery_jobs WHERE id = ?').get(jobId) as
        JsonMap | undefined;
      if (!source) throw new Error('Article delivery job not found');
      if (text(source.status) !== 'FAILED') throw new Error('Only failed article deliveries can be retried');
      return this.enqueue({
        extensionId: text(source.extension_id),
        channelId: text(source.channel_id),
        spaceId: text(source.space_id),
        articleId: text(source.article_id),
        articleRevisionId: text(source.article_revision_id),
        articleContentHash: text(source.article_content_hash),
        targetSlug: text(source.target_slug),
        targetDescription: text(source.target_description),
        watermarkProfile: jobDto(source).watermarkProfile,
        retryOfJobId: text(source.id),
      });
    })();
  }

  recoverRunning() {
    const timestamp = now();
    return this.db
      .prepare(
        `UPDATE article_delivery_jobs
        SET status = 'QUEUED', error_code = 'APP_RESTARTED',
          error_message = 'Delivery resumed after the application restarted', retryable = 1,
          started_at = NULL, completed_at = NULL, updated_at = ?
        WHERE status = 'RUNNING'`,
      )
      .run(timestamp).changes;
  }

  private insert(input: ArticleDeliveryJobCreateInput) {
    const id = ulid();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO article_delivery_jobs
        (id,extension_id,channel_id,space_id,article_id,article_revision_id,article_content_hash,
          target_slug,target_description,watermark_profile_json,status,attempt_count,result_json,error_code,error_message,retryable,
          retry_of_job_id,created_at,started_at,completed_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'QUEUED',0,NULL,NULL,NULL,0,?,?,NULL,NULL,?)`,
      )
      .run(
        id,
        input.extensionId,
        input.channelId,
        input.spaceId,
        input.articleId,
        input.articleRevisionId,
        input.articleContentHash,
        input.targetSlug,
        input.targetDescription,
        input.watermarkProfile ? JSON.stringify(naturalWatermarkProfileSchema.parse(input.watermarkProfile)) : null,
        input.retryOfJobId ?? null,
        timestamp,
        timestamp,
      );
    const job = this.require(id);
    this.record(job, 'ENQUEUE');
    return job;
  }

  private require(jobId: string) {
    const row = this.db.prepare('SELECT * FROM article_delivery_jobs WHERE id = ?').get(jobId) as JsonMap | undefined;
    if (!row) throw new Error('Article delivery job not found');
    return jobDto(row);
  }

  private record(job: ArticleDeliveryJob, operation: string) {
    this.storage.recordChange(
      'ARTICLE_DELIVERY_JOB',
      job.id,
      operation,
      { articleId: job.articleId, status: job.status },
      { affectsFileView: false },
    );
  }
}
