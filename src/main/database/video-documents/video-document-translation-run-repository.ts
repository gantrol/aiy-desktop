import { z } from 'zod';
import type { VideoDocumentGenerationErrorDetails, VideoDocumentTokenUsage } from '@/shared/contracts/video-document';
import type {
  VideoDocumentTranscriptTranslationExecution,
  VideoDocumentTranscriptTranslationRunDto,
} from '@/shared/contracts/video-document-translation';
import {
  videoDocumentTranscriptTranslationRunSchema,
  videoDocumentTranslationLocaleSchema,
} from '@/shared/contracts/video-document-translation';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';

const targetLocalesSchema = z.array(videoDocumentTranslationLocaleSchema).min(1).max(5);

function jsonValue(value: unknown) {
  try {
    return JSON.parse(text(value)) as unknown;
  } catch {
    throw new Error('Stored video document translation data is invalid');
  }
}

function usageFromRow(row: JsonMap): VideoDocumentTokenUsage | null {
  const values = {
    inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
    cachedInputTokens: row.cached_input_tokens === null ? null : Number(row.cached_input_tokens),
    outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
    reasoningOutputTokens: row.reasoning_output_tokens === null ? null : Number(row.reasoning_output_tokens),
    totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
  };
  return Object.values(values).every((value) => value === null) ? null : values;
}

export function videoDocumentTranslationRunDto(row: JsonMap): VideoDocumentTranscriptTranslationRunDto {
  return videoDocumentTranscriptTranslationRunSchema.parse({
    id: text(row.id),
    documentId: text(row.document_id),
    branchId: text(row.branch_id),
    inputRevisionId: row.input_revision_id ? text(row.input_revision_id) : null,
    outputRevisionId: row.output_revision_id ? text(row.output_revision_id) : null,
    targetLocales: targetLocalesSchema.parse(jsonValue(row.target_locales_json)),
    status: text(row.status),
    providerKey: text(row.provider_key),
    requestedModel: text(row.requested_model),
    actualModel: row.actual_model ? text(row.actual_model) : null,
    reasoningEffort: text(row.reasoning_effort),
    completedBatches: Number(row.completed_batches),
    totalBatches: row.total_batches === null ? null : Number(row.total_batches),
    usageAvailability: text(row.usage_availability),
    usage: usageFromRow(row),
    errorCode: row.error_code ? text(row.error_code) : null,
    errorDetails: row.error_detail_json ? jsonValue(row.error_detail_json) : null,
    startedAt: text(row.started_at),
    finishedAt: row.finished_at ? text(row.finished_at) : null,
  });
}

function usageColumns(usage: VideoDocumentTokenUsage | null) {
  return [
    usage?.inputTokens ?? null,
    usage?.cachedInputTokens ?? null,
    usage?.outputTokens ?? null,
    usage?.reasoningOutputTokens ?? null,
    usage?.totalTokens ?? null,
  ];
}

export class VideoDocumentTranslationRunRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  start(input: {
    operationId: string;
    documentId: string;
    branchId: string;
    inputRevisionId: string | null;
    targetLocales: string[];
    execution: VideoDocumentTranscriptTranslationExecution;
  }) {
    const startedAt = now();
    this.db
      .prepare(
        `INSERT INTO video_document_translation_runs
        (id, document_id, branch_id, input_revision_id, output_revision_id, target_locales_json,
          status, provider_key, requested_model, actual_model, reasoning_effort,
          completed_batches, total_batches, usage_availability,
          input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
          error_code, error_detail_json, started_at, finished_at)
        VALUES (?, ?, ?, ?, NULL, ?, 'RUNNING', 'codex', ?, NULL, ?,
          0, NULL, 'NOT_STARTED', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        input.operationId,
        input.documentId,
        input.branchId,
        input.inputRevisionId,
        JSON.stringify(targetLocalesSchema.parse(input.targetLocales)),
        input.execution.modelKey,
        input.execution.reasoningEffort,
        startedAt,
      );
    this.storage.recordChange('VIDEO_DOCUMENT_TRANSLATION_RUN', input.operationId, 'CREATE', {
      documentId: input.documentId,
      targetLocales: input.targetLocales,
    });
    return this.get(input.operationId);
  }

  updateProgress(input: { operationId: string; completedBatches: number; totalBatches: number }) {
    const result = this.db
      .prepare(
        `UPDATE video_document_translation_runs
        SET completed_batches = ?, total_batches = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(input.completedBatches, input.totalBatches, input.operationId);
    if (result.changes === 1) {
      this.storage.recordChange('VIDEO_DOCUMENT_TRANSLATION_RUN', input.operationId, 'PROGRESS', {
        completedBatches: input.completedBatches,
        totalBatches: input.totalBatches,
      });
    }
    return this.get(input.operationId);
  }

  completeInTransaction(input: {
    operationId: string;
    outputRevisionId: string;
    actualModel: string;
    usage: VideoDocumentTokenUsage | null;
    completedBatches: number;
    totalBatches: number;
    finishedAt: string;
  }) {
    const result = this.db
      .prepare(
        `UPDATE video_document_translation_runs
        SET status = 'SUCCEEDED', output_revision_id = ?, actual_model = ?,
          completed_batches = ?, total_batches = ?, usage_availability = ?,
          input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_output_tokens = ?, total_tokens = ?,
          error_code = NULL, error_detail_json = NULL, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(
        input.outputRevisionId,
        input.actualModel,
        input.completedBatches,
        input.totalBatches,
        input.usage ? 'PROVIDED' : 'MISSING',
        ...usageColumns(input.usage),
        input.finishedAt,
        input.operationId,
      );
    if (result.changes !== 1) throw new Error('VIDEO_DOCUMENT_TRANSLATION_STATE_CHANGED');
    this.storage.recordChange('VIDEO_DOCUMENT_TRANSLATION_RUN', input.operationId, 'SUCCEED', {
      outputRevisionId: input.outputRevisionId,
    });
    return this.get(input.operationId);
  }

  fail(input: {
    operationId: string;
    failure: VideoDocumentGenerationErrorDetails;
    actualModel: string | null;
    usage: VideoDocumentTokenUsage | null;
    finishedAt: string;
  }) {
    const status = input.failure.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    const usageAvailability = input.usage ? 'PROVIDED' : input.actualModel ? 'MISSING' : 'NOT_STARTED';
    const result = this.db
      .prepare(
        `UPDATE video_document_translation_runs
        SET status = ?, actual_model = ?, usage_availability = ?,
          input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_output_tokens = ?, total_tokens = ?,
          error_code = ?, error_detail_json = ?, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(
        status,
        input.actualModel,
        usageAvailability,
        ...usageColumns(input.usage),
        input.failure.code,
        JSON.stringify(input.failure),
        input.finishedAt,
        input.operationId,
      );
    if (result.changes === 1) {
      this.storage.recordChange('VIDEO_DOCUMENT_TRANSLATION_RUN', input.operationId, status, {
        errorCode: input.failure.code,
      });
    }
    return this.get(input.operationId);
  }

  interruptRunning() {
    const rows = this.db
      .prepare("SELECT id FROM video_document_translation_runs WHERE status = 'RUNNING'")
      .all() as JsonMap[];
    const finishedAt = now();
    for (const row of rows) {
      const operationId = text(row.id);
      const failure: VideoDocumentGenerationErrorDetails = {
        code: 'INTERRUPTED',
        retryable: true,
        resetAt: null,
        diagnostic: null,
      };
      this.db
        .prepare(
          `UPDATE video_document_translation_runs
          SET status = 'INTERRUPTED', error_code = 'INTERRUPTED', error_detail_json = ?, finished_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(JSON.stringify(failure), finishedAt, operationId);
      this.storage.recordChange('VIDEO_DOCUMENT_TRANSLATION_RUN', operationId, 'INTERRUPTED', {});
    }
    return rows.length;
  }

  get(operationId: string) {
    const row = this.db.prepare('SELECT * FROM video_document_translation_runs WHERE id = ?').get(operationId) as
      JsonMap | undefined;
    if (!row) throw new Error('Video document translation run not found');
    return videoDocumentTranslationRunDto(row);
  }
}
