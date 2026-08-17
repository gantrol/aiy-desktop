import { ulid } from 'ulid';
import type {
  VideoDocumentGenerationErrorDetails,
  VideoDocumentGenerationRunDto,
  VideoDocumentGenerationRunsListInput,
  VideoDocumentGenerationRunsPage,
  VideoDocumentTokenUsage,
} from '@/shared/contracts/video-document';
import { videoDocumentGenerationErrorDetailsSchema } from '@/shared/contracts/video-document';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';

function encodeOffsetCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeOffsetCursor(value: string | null | undefined) {
  if (!value) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const offset = parsed && typeof parsed === 'object' && 'offset' in parsed ? parsed.offset : undefined;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw new Error('Invalid generation run cursor');
  }
}

function errorCode(reason: unknown) {
  const value =
    reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string'
      ? reason.code
      : 'VIDEO_DOCUMENT_GENERATION_FAILED';
  return value.trim().slice(0, 100) || 'VIDEO_DOCUMENT_GENERATION_FAILED';
}

function errorDetails(reason: unknown): VideoDocumentGenerationErrorDetails {
  const source = reason && typeof reason === 'object' ? reason : null;
  const code = errorCode(reason);
  const retryable = source && 'retryable' in source && typeof source.retryable === 'boolean' ? source.retryable : false;
  const resetAt =
    source && 'resetAt' in source && (typeof source.resetAt === 'string' || source.resetAt === null)
      ? source.resetAt
      : null;
  const message = reason instanceof Error ? reason.message : null;
  return videoDocumentGenerationErrorDetailsSchema.parse({
    code,
    retryable,
    resetAt,
    diagnostic: message?.trim() ? message.trim().slice(0, 2_000) : null,
  });
}

function tokenUsage(row: JsonMap): VideoDocumentTokenUsage {
  return {
    inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
    cachedInputTokens: row.cached_input_tokens === null ? null : Number(row.cached_input_tokens),
    outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
    reasoningOutputTokens: row.reasoning_output_tokens === null ? null : Number(row.reasoning_output_tokens),
    totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
  };
}

export function videoDocumentGenerationRunDto(row: JsonMap): VideoDocumentGenerationRunDto {
  const usageAvailability = text(row.usage_availability) as VideoDocumentGenerationRunDto['usageAvailability'];
  let details: VideoDocumentGenerationErrorDetails | null = null;
  if (row.error_detail_json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text(row.error_detail_json));
    } catch {
      throw new Error('Video document generation error details are invalid');
    }
    details = videoDocumentGenerationErrorDetailsSchema.parse(parsed);
  }
  return {
    id: text(row.id),
    documentId: text(row.document_id),
    branchId: text(row.branch_id),
    status: text(row.status) as VideoDocumentGenerationRunDto['status'],
    inputRevisionId: row.input_revision_id ? text(row.input_revision_id) : null,
    outputRevisionId: row.output_revision_id ? text(row.output_revision_id) : null,
    providerKey: 'codex',
    requestedModel: text(row.requested_model),
    actualModel: row.actual_model ? text(row.actual_model) : null,
    reasoningEffort: 'max',
    usageAvailability,
    usage: usageAvailability === 'PROVIDED' ? tokenUsage(row) : null,
    errorCode: row.error_code ? text(row.error_code) : null,
    errorDetails: details,
    startedAt: text(row.started_at),
    finishedAt: row.finished_at ? text(row.finished_at) : null,
  };
}

export class VideoDocumentGenerationRunRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  list(input: VideoDocumentGenerationRunsListInput): VideoDocumentGenerationRunsPage {
    this.requireDocument(input.documentId);
    const offset = decodeOffsetCursor(input.cursor);
    const limit = Math.min(input.limit ?? 20, 50);
    const rows = this.db
      .prepare(
        `SELECT * FROM video_document_generation_runs
        WHERE document_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      )
      .all(input.documentId, limit + 1, offset) as JsonMap[];
    const hasMore = rows.length > limit;
    return {
      items: (hasMore ? rows.slice(0, limit) : rows).map(videoDocumentGenerationRunDto),
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
    };
  }

  recordStopped(input: {
    documentId: string;
    branchId: string;
    inputRevisionId: string | null;
    requestedModel: string;
    status: 'BLOCKED' | 'NOT_STARTED';
    reason: unknown;
  }) {
    this.requireDocument(input.documentId);
    const runId = ulid();
    const timestamp = now();
    const details = errorDetails(input.reason);
    this.db
      .prepare(
        `INSERT INTO video_document_generation_runs
        (id, document_id, branch_id, operation, status, input_revision_id, output_revision_id,
          provider_key, requested_model, actual_model, reasoning_effort, usage_availability,
          input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
          error_code, error_detail_json, started_at, finished_at)
        VALUES (?, ?, ?, 'ARTICLE_GENERATE', ?, ?, NULL,
          'codex', ?, NULL, 'max', 'NOT_STARTED',
          NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        input.documentId,
        input.branchId,
        input.status,
        input.inputRevisionId,
        input.requestedModel,
        details.code,
        JSON.stringify(details),
        timestamp,
        timestamp,
      );
    this.storage.recordChange('VIDEO_DOCUMENT_GENERATION_RUN', runId, input.status, {
      documentId: input.documentId,
      errorCode: details.code,
      usageAvailability: 'NOT_STARTED',
    });
    return this.get(runId);
  }

  start(input: { documentId: string; branchId: string; inputRevisionId: string | null; requestedModel: string }) {
    const runId = ulid();
    const startedAt = now();
    try {
      this.db
        .transaction(() => {
          const ownership = input.inputRevisionId
            ? this.db
                .prepare(
                  `SELECT branch.id
                  FROM document_branches branch
                  JOIN document_drafts transcript_draft ON transcript_draft.branch_id IN (
                    SELECT id FROM document_branches
                    WHERE document_id = branch.document_id AND role = 'CLEAN_TRANSCRIPT' AND deleted_at IS NULL
                  ) AND transcript_draft.deleted_at IS NULL
                  JOIN document_draft_revisions transcript_revision
                    ON transcript_revision.draft_id = transcript_draft.id AND transcript_revision.id = ?
                  WHERE branch.id = ? AND branch.document_id = ? AND branch.role = 'ARTICLE'
                    AND branch.deleted_at IS NULL`,
                )
                .get(input.inputRevisionId, input.branchId, input.documentId)
            : this.db
                .prepare(
                  `SELECT branch.id
                  FROM document_branches branch
                  WHERE branch.id = ? AND branch.document_id = ? AND branch.role = 'ARTICLE'
                    AND branch.deleted_at IS NULL
                    AND NOT EXISTS (
                      SELECT 1
                      FROM document_branches transcript_branch
                      JOIN document_drafts transcript_draft
                        ON transcript_draft.branch_id = transcript_branch.id AND transcript_draft.deleted_at IS NULL
                      JOIN document_draft_revisions transcript_revision
                        ON transcript_revision.draft_id = transcript_draft.id
                      WHERE transcript_branch.document_id = branch.document_id
                        AND transcript_branch.role = 'CLEAN_TRANSCRIPT'
                        AND transcript_branch.deleted_at IS NULL
                    )`,
                )
                .get(input.branchId, input.documentId);
          if (!ownership) throw new Error('VIDEO_DOCUMENT_GENERATION_INPUT_CHANGED');
          this.db
            .prepare(
              `INSERT INTO video_document_generation_runs
              (id, document_id, branch_id, operation, status, input_revision_id, output_revision_id,
                provider_key, requested_model, actual_model, reasoning_effort, usage_availability,
                input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
                error_code, error_detail_json, started_at, finished_at)
              VALUES (?, ?, ?, 'ARTICLE_GENERATE', 'RUNNING', ?, NULL,
                'codex', ?, NULL, 'max', 'MISSING', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL)`,
            )
            .run(runId, input.documentId, input.branchId, input.inputRevisionId, input.requestedModel, startedAt);
          this.db
            .prepare("UPDATE document_branches SET status = 'PROCESSING', updated_at = ? WHERE id = ?")
            .run(startedAt, input.branchId);
          this.storage.recordChange('VIDEO_DOCUMENT_GENERATION_RUN', runId, 'CREATE', input);
          this.storage.recordChange('DOCUMENT_BRANCH', input.branchId, 'UPDATE', { status: 'PROCESSING' });
        })
        .immediate();
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw Object.assign(new Error('A document generation is already running'), {
          code: 'VIDEO_DOCUMENT_GENERATION_BUSY' as const,
        });
      }
      throw error;
    }
    return this.get(runId);
  }

  completeInTransaction(input: {
    runId: string;
    outputRevisionId: string;
    actualModel: string | null;
    usage: VideoDocumentTokenUsage | null;
    finishedAt: string;
  }) {
    const run = this.requireRunning(input.runId);
    const output = this.db
      .prepare(
        `SELECT revision.id
        FROM document_draft_revisions revision
        JOIN document_drafts draft ON draft.id = revision.draft_id
        WHERE revision.id = ? AND draft.branch_id = ? AND draft.deleted_at IS NULL`,
      )
      .get(input.outputRevisionId, text(run.branch_id));
    if (!output) throw new Error('VIDEO_DOCUMENT_GENERATION_OUTPUT_UNAVAILABLE');
    const usage = input.usage;
    const result = this.db
      .prepare(
        `UPDATE video_document_generation_runs
        SET status = 'SUCCEEDED', output_revision_id = ?, actual_model = ?,
          usage_availability = ?, input_tokens = ?, cached_input_tokens = ?, output_tokens = ?,
          reasoning_output_tokens = ?, total_tokens = ?, error_code = NULL,
          error_detail_json = NULL, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(
        input.outputRevisionId,
        input.actualModel,
        usage ? 'PROVIDED' : 'MISSING',
        usage?.inputTokens ?? null,
        usage?.cachedInputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.reasoningOutputTokens ?? null,
        usage?.totalTokens ?? null,
        input.finishedAt,
        input.runId,
      );
    if (result.changes !== 1) throw new Error('VIDEO_DOCUMENT_GENERATION_STATE_CHANGED');
    this.storage.recordChange('VIDEO_DOCUMENT_GENERATION_RUN', input.runId, 'SUCCEED', {
      outputRevisionId: input.outputRevisionId,
      usageAvailability: usage ? 'PROVIDED' : 'MISSING',
    });
    return this.get(input.runId);
  }

  fail(
    runId: string,
    reason: unknown,
    providerResult: { actualModel?: string | null; usage?: VideoDocumentTokenUsage | null } = {},
  ) {
    const details = errorDetails(reason);
    const status =
      details.code === 'CANCELLED' ? 'CANCELLED' : details.code === 'INTERRUPTED' ? 'INTERRUPTED' : 'FAILED';
    const finishedAt = now();
    this.db
      .transaction(() => {
        const run = this.requireRunning(runId);
        const result = this.db
          .prepare(
            `UPDATE video_document_generation_runs
            SET status = ?, actual_model = ?, usage_availability = ?,
              input_tokens = ?, cached_input_tokens = ?, output_tokens = ?,
              reasoning_output_tokens = ?, total_tokens = ?, error_code = ?,
              error_detail_json = ?, finished_at = ?
            WHERE id = ? AND status = 'RUNNING'`,
          )
          .run(
            status,
            providerResult.actualModel ?? null,
            providerResult.usage ? 'PROVIDED' : 'MISSING',
            providerResult.usage?.inputTokens ?? null,
            providerResult.usage?.cachedInputTokens ?? null,
            providerResult.usage?.outputTokens ?? null,
            providerResult.usage?.reasoningOutputTokens ?? null,
            providerResult.usage?.totalTokens ?? null,
            details.code,
            JSON.stringify(details),
            finishedAt,
            runId,
          );
        if (result.changes !== 1) return;
        const hasRevision = this.db
          .prepare(
            `SELECT 1 FROM document_draft_revisions revision
            JOIN document_drafts draft ON draft.id = revision.draft_id
            WHERE draft.branch_id = ? AND draft.deleted_at IS NULL LIMIT 1`,
          )
          .get(text(run.branch_id));
        const branchStatus = hasRevision ? 'EDITABLE' : 'FAILED';
        this.db
          .prepare('UPDATE document_branches SET status = ?, updated_at = ? WHERE id = ?')
          .run(branchStatus, finishedAt, text(run.branch_id));
        this.storage.recordChange('VIDEO_DOCUMENT_GENERATION_RUN', runId, status, {
          errorCode: details.code,
          retryable: details.retryable,
          usageAvailability: providerResult.usage ? 'PROVIDED' : 'MISSING',
        });
        this.storage.recordChange('DOCUMENT_BRANCH', text(run.branch_id), 'UPDATE', { status: branchStatus });
      })
      .immediate();
    return this.get(runId);
  }

  interruptRunning() {
    const rows = this.db
      .prepare("SELECT id FROM video_document_generation_runs WHERE status = 'RUNNING'")
      .all() as JsonMap[];
    for (const row of rows) {
      this.fail(
        text(row.id),
        Object.assign(new Error('Video document generation was interrupted'), { code: 'INTERRUPTED' }),
      );
    }
  }

  private get(runId: string) {
    const row = this.db.prepare('SELECT * FROM video_document_generation_runs WHERE id = ?').get(runId) as
      JsonMap | undefined;
    if (!row) throw new Error('Video document generation run not found');
    return videoDocumentGenerationRunDto(row);
  }

  private requireRunning(runId: string) {
    const row = this.db
      .prepare("SELECT * FROM video_document_generation_runs WHERE id = ? AND status = 'RUNNING'")
      .get(runId) as JsonMap | undefined;
    if (!row) throw new Error('VIDEO_DOCUMENT_GENERATION_NOT_RUNNING');
    return row;
  }

  private requireDocument(documentId: string) {
    if (!this.db.prepare('SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL').get(documentId)) {
      throw new Error('Document not found');
    }
  }
}
