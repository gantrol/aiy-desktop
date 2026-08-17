import { z } from 'zod';
import {
  generationProcessEventHeaderSchema,
  generationProcessEventPageInputSchema,
  generationProcessEventPageSchema,
  generationProcessSummarySchema,
  type GenerationProcessEventPageDto,
  type GenerationProcessEventPageInput,
  type GenerationProcessEventPayloadDto,
  type GenerationProcessSummaryDto,
} from '@/shared/contracts/generation-process';
import type { LibraryStorage } from '@/main/database/core/storage';
import type { JsonMap } from '@/main/database/core/values';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_STATUS_MESSAGE_BYTES = 1_000;

const idSchema = z.string().min(1).max(200);
const keySchema = z.string().min(1).max(200);
const nullableKeySchema = keySchema.nullable();
const timestampSchema = z.string().min(1).max(100);
const statusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

const summaryRowSchema = z.object({
  run_id: idSchema,
  job_id: idSchema,
  root_run_id: idSchema,
  retry_of_run_id: idSchema.nullable(),
  status: statusSchema,
  phase: keySchema,
  progress: z.number().min(0).max(1).nullable(),
  status_message: z.string().max(MAX_STATUS_MESSAGE_BYTES).nullable(),
  status_message_omitted: z.union([z.literal(0), z.literal(1)]),
  provider_key: nullableKeySchema,
  has_provider_request_id: z.union([z.literal(0), z.literal(1)]),
  error_code: nullableKeySchema,
  error_code_omitted: z.union([z.literal(0), z.literal(1)]),
  attempt_count: z.number().int().nonnegative(),
  event_count: z.number().int().nonnegative(),
  output_count: z.number().int().nonnegative(),
  latest_sequence: z.number().int().nonnegative(),
  created_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  finished_at: timestampSchema.nullable(),
  updated_at: timestampSchema,
});

const eventRowSchema = z.object({
  id: idSchema,
  attempt_id: idSchema.nullable(),
  sequence: z.number().int().positive(),
  event_type: keySchema,
  phase: keySchema.nullable(),
  progress: z.number().min(0).max(1).nullable(),
  status_message: z.string().max(MAX_STATUS_MESSAGE_BYTES).nullable(),
  status_message_omitted: z.union([z.literal(0), z.literal(1)]),
  payload_json: z.string().max(MAX_PAYLOAD_BYTES).nullable(),
  payload_oversized: z.union([z.literal(0), z.literal(1)]),
  created_at: timestampSchema,
});

const ownedJobRowSchema = z.object({ job_id: idSchema });

const objectPayloadSchema = z.record(z.string(), z.unknown());
const providerRequestPayloadSchema = z.object({
  providerKey: nullableKeySchema.optional(),
  providerRequestId: z.string().min(1).max(500),
  remoteOperationAccepted: z.boolean().optional(),
});
const failurePayloadSchema = z.object({
  errorCode: nullableKeySchema.optional(),
  errorDetails: z
    .object({
      retryable: z.boolean(),
      providerCode: nullableKeySchema,
      metadata: z.unknown().optional(),
    })
    .optional(),
});
const outputPayloadSchema = z.object({
  assetId: idSchema,
  providerOutputId: z.string().min(1).max(500).nullable().optional(),
});

function eventPayload(
  eventType: string,
  payloadJson: string | null,
  oversized: boolean,
): GenerationProcessEventPayloadDto {
  if (oversized) return { kind: 'UNAVAILABLE', reason: 'OVERSIZED' };
  if (payloadJson === null) return { kind: 'UNAVAILABLE', reason: 'MALFORMED' };

  let value: unknown;
  try {
    value = JSON.parse(payloadJson) as unknown;
  } catch {
    return { kind: 'UNAVAILABLE', reason: 'MALFORMED' };
  }

  if (
    eventType === 'REQUEST_IDENTIFIED' ||
    eventType === 'REQUEST_ACCEPTED' ||
    eventType === 'REMOTE_OPERATION_ACCEPTED'
  ) {
    const parsed = providerRequestPayloadSchema.safeParse(value);
    if (!parsed.success) return { kind: 'UNAVAILABLE', reason: 'MALFORMED' };
    return {
      kind: 'PROVIDER_REQUEST',
      providerKey: parsed.data.providerKey ?? null,
      hasProviderRequestId: true,
      remoteOperationAccepted:
        eventType === 'REMOTE_OPERATION_ACCEPTED' || parsed.data.remoteOperationAccepted === true,
    };
  }

  if (['FAILED', 'CANCELLED', 'INTERRUPTED', 'APPLICATION_CLOSED'].includes(eventType)) {
    const parsed = failurePayloadSchema.safeParse(value);
    if (!parsed.success) return { kind: 'UNAVAILABLE', reason: 'MALFORMED' };
    return {
      kind: 'FAILURE',
      errorCode: parsed.data.errorCode ?? null,
      retryable: parsed.data.errorDetails?.retryable ?? null,
      providerCode: parsed.data.errorDetails?.providerCode ?? null,
    };
  }

  if (eventType === 'SUCCEEDED') {
    const parsed = outputPayloadSchema.safeParse(value);
    if (!parsed.success) return { kind: 'UNAVAILABLE', reason: 'MALFORMED' };
    return {
      kind: 'OUTPUT',
      assetId: parsed.data.assetId,
      hasProviderOutputId: Boolean(parsed.data.providerOutputId),
    };
  }

  if (['CREATED', 'RETRY_CREATED', 'QUEUED', 'RUNNING', 'PHASE_CHANGED', 'CHECKPOINT_SAVED'].includes(eventType)) {
    return objectPayloadSchema.safeParse(value).success
      ? { kind: 'NONE' }
      : { kind: 'UNAVAILABLE', reason: 'MALFORMED' };
  }

  return objectPayloadSchema.safeParse(value).success
    ? { kind: 'UNAVAILABLE', reason: 'UNSUPPORTED_EVENT' }
    : { kind: 'UNAVAILABLE', reason: 'MALFORMED' };
}

/** Read-only, on-demand projection of durable generation process evidence. */
export class GenerationProcessRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  summary(runId: string): GenerationProcessSummaryDto | null {
    const validatedRunId = idSchema.parse(runId);
    const row = this.db
      .prepare(
        `SELECT
          link.generation_run_id AS run_id,
          job.id AS job_id,
          root_link.generation_run_id AS root_run_id,
          retry_link.generation_run_id AS retry_of_run_id,
          job.status,
          job.phase,
          job.progress,
          CASE
            WHEN job.status_message IS NULL THEN NULL
            WHEN length(CAST(job.status_message AS BLOB)) <= ? THEN job.status_message
            ELSE NULL
          END AS status_message,
          CASE
            WHEN job.status_message IS NOT NULL
              AND length(CAST(job.status_message AS BLOB)) > ? THEN 1
            ELSE 0
          END AS status_message_omitted,
          job.provider_key,
          CASE WHEN job.provider_request_id IS NULL OR job.provider_request_id = '' THEN 0 ELSE 1 END
            AS has_provider_request_id,
          CASE
            WHEN job.error_code IS NULL THEN NULL
            WHEN length(CAST(job.error_code AS BLOB)) <= 200 THEN job.error_code
            ELSE NULL
          END AS error_code,
          CASE
            WHEN job.error_code IS NOT NULL AND length(CAST(job.error_code AS BLOB)) > 200 THEN 1
            ELSE 0
          END AS error_code_omitted,
          (SELECT COUNT(*) FROM background_job_attempts attempt WHERE attempt.job_id = job.id) AS attempt_count,
          (SELECT COUNT(*) FROM background_job_events event WHERE event.job_id = job.id) AS event_count,
          (SELECT COUNT(*) FROM generation_outputs output WHERE output.job_id = job.id) AS output_count,
          COALESCE(
            (SELECT MAX(event.sequence) FROM background_job_events event WHERE event.job_id = job.id),
            0
          ) AS latest_sequence,
          job.created_at,
          job.started_at,
          job.finished_at,
          job.updated_at
        FROM background_jobs job
        JOIN generation_job_links link ON link.job_id = job.id
        JOIN generation_job_links root_link ON root_link.job_id = job.root_job_id
        LEFT JOIN generation_job_links retry_link ON retry_link.job_id = job.retry_of_job_id
        WHERE link.generation_run_id = ? AND job.kind = 'GENERATION'`,
      )
      .get(MAX_STATUS_MESSAGE_BYTES, MAX_STATUS_MESSAGE_BYTES, validatedRunId) as JsonMap | undefined;
    if (!row) return null;
    const value = summaryRowSchema.parse(row);
    return generationProcessSummarySchema.parse({
      runId: value.run_id,
      jobId: value.job_id,
      rootRunId: value.root_run_id,
      retryOfRunId: value.retry_of_run_id,
      status: value.status,
      phase: value.phase,
      progress: value.progress,
      statusMessage: value.status_message,
      statusMessageOmitted: value.status_message_omitted === 1,
      providerKey: value.provider_key,
      hasProviderRequestId: value.has_provider_request_id === 1,
      errorCode: value.error_code,
      errorCodeOmitted: value.error_code_omitted === 1,
      attemptCount: value.attempt_count,
      eventCount: value.event_count,
      outputCount: value.output_count,
      latestSequence: value.latest_sequence,
      createdAt: value.created_at,
      startedAt: value.started_at,
      finishedAt: value.finished_at,
      updatedAt: value.updated_at,
    });
  }

  events(input: GenerationProcessEventPageInput): GenerationProcessEventPageDto | null {
    const validatedInput = generationProcessEventPageInputSchema.parse(input);
    const ownedJob = this.db
      .prepare(
        `SELECT job.id AS job_id
        FROM background_jobs job
        JOIN generation_job_links link ON link.job_id = job.id
        WHERE link.generation_run_id = ? AND job.kind = 'GENERATION'`,
      )
      .get(validatedInput.runId) as JsonMap | undefined;
    if (!ownedJob) return null;
    const jobId = ownedJobRowSchema.parse(ownedJob).job_id;

    const afterSequence = validatedInput.afterSequence ?? 0;
    const limit = validatedInput.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = this.db
      .prepare(
        `SELECT
          event.id,
          event.attempt_id,
          event.sequence,
          event.event_type,
          event.phase,
          event.progress,
          CASE
            WHEN event.status_message IS NULL THEN NULL
            WHEN length(CAST(event.status_message AS BLOB)) <= ? THEN event.status_message
            ELSE NULL
          END AS status_message,
          CASE
            WHEN event.status_message IS NOT NULL
              AND length(CAST(event.status_message AS BLOB)) > ? THEN 1
            ELSE 0
          END AS status_message_omitted,
          CASE
            WHEN length(CAST(event.payload_json AS BLOB)) <= ? THEN event.payload_json
            ELSE NULL
          END AS payload_json,
          CASE WHEN length(CAST(event.payload_json AS BLOB)) > ? THEN 1 ELSE 0 END AS payload_oversized,
          event.created_at
        FROM background_job_events event
        WHERE event.job_id = ? AND event.sequence > ?
        ORDER BY event.sequence ASC
        LIMIT ?`,
      )
      .all(
        MAX_STATUS_MESSAGE_BYTES,
        MAX_STATUS_MESSAGE_BYTES,
        MAX_PAYLOAD_BYTES,
        MAX_PAYLOAD_BYTES,
        jobId,
        afterSequence,
        limit + 1,
      ) as JsonMap[];

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((rawRow) => {
      const row = eventRowSchema.parse(rawRow);
      return generationProcessEventHeaderSchema.parse({
        id: row.id,
        attemptId: row.attempt_id,
        sequence: row.sequence,
        eventType: row.event_type,
        phase: row.phase,
        progress: row.progress,
        statusMessage: row.status_message,
        statusMessageOmitted: row.status_message_omitted === 1,
        payload: eventPayload(row.event_type, row.payload_json, row.payload_oversized === 1),
        createdAt: row.created_at,
      });
    });
    return generationProcessEventPageSchema.parse({
      runId: validatedInput.runId,
      items,
      nextCursor: items.at(-1)?.sequence ?? validatedInput.afterSequence ?? null,
      hasMore,
    });
  }
}
