import { ulid } from 'ulid';
import type {
  GenerationQuality,
  TermIllustrationBatchDto,
  TermIllustrationDecisionResult,
  TermIllustrationListDto,
  TermIllustrationPurpose,
} from '@/shared/contracts';
import type { DictionaryRepository } from '@/main/database/dictionary/dictionary-repository';
import type { LibraryStorage } from '@/main/database/core/storage';
import { mediaUrl, now, text, type JsonMap } from '@/main/database/core/values';

interface CreateTermIllustrationBatchInput {
  termId: string;
  termRevisionId: string;
  purpose: TermIllustrationPurpose;
  profileId: string;
  profileRevision: number;
  promptProfileId: string;
  expressionRevisionId: string;
  modelKey: string;
  quality: GenerationQuality;
}

interface AttachTermIllustrationGenerationInput {
  seriesId: string;
  versionId: string;
  runIds: string[];
}

function nullableText(value: unknown) {
  return value == null ? null : text(value);
}

function limitedError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  return message.slice(0, 10_000);
}

export class TermIllustrationRepository {
  private readonly db: LibraryStorage['db'];

  constructor(
    private readonly storage: LibraryStorage,
    private readonly dictionary: DictionaryRepository,
  ) {
    this.db = storage.db;
  }

  createPreparing(input: CreateTermIllustrationBatchInput) {
    const id = ulid();
    const createdAt = now();
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO term_illustration_batches
            (id, term_id, term_revision_id, purpose, profile_id, profile_revision, prompt_profile_id,
              expression_revision_id, model_key, quality, series_id, prompt_version_id, status,
              error_code, error_message, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'PREPARING', NULL, NULL, ?, ?)`,
          )
          .run(
            id,
            input.termId,
            input.termRevisionId,
            input.purpose,
            input.profileId,
            input.profileRevision,
            input.promptProfileId,
            input.expressionRevisionId,
            input.modelKey,
            input.quality,
            createdAt,
            createdAt,
          );
        this.storage.recordChange('TERM_ILLUSTRATION_BATCH', id, 'CREATE', input, { affectsFileView: false });
      })
      .immediate();
    return id;
  }

  attachGeneration(batchId: string, input: AttachTermIllustrationGenerationInput) {
    const updatedAt = now();
    this.db
      .transaction(() => {
        const update = this.db
          .prepare(
            `UPDATE term_illustration_batches
            SET series_id = ?, prompt_version_id = ?, status = 'SUBMITTED', updated_at = ?
            WHERE id = ? AND status = 'PREPARING'`,
          )
          .run(input.seriesId, input.versionId, updatedAt, batchId);
        if (update.changes !== 1) throw new Error('Term illustration batch is not awaiting submission');

        const insert = this.db.prepare(
          `INSERT INTO term_illustration_batch_runs
          (id, batch_id, generation_run_id, decision, term_media_link_id, decided_at, created_at)
          VALUES (?, ?, ?, 'PENDING', NULL, NULL, ?)`,
        );
        for (const runId of input.runIds) {
          const batchRunId = ulid();
          insert.run(batchRunId, batchId, runId, updatedAt);
          this.storage.recordChange(
            'TERM_ILLUSTRATION_RUN',
            batchRunId,
            'CREATE',
            { batchId, generationRunId: runId },
            { affectsFileView: false },
          );
        }
        this.storage.recordChange('TERM_ILLUSTRATION_BATCH', batchId, 'SUBMIT', input, {
          affectsFileView: false,
        });
      })
      .immediate();
  }

  markFailed(batchId: string, reason: unknown) {
    const errorMessage = limitedError(reason);
    const updatedAt = now();
    this.db
      .transaction(() => {
        const result = this.db
          .prepare(
            `UPDATE term_illustration_batches
            SET status = 'FAILED', error_code = 'SUBMISSION_FAILED', error_message = ?, updated_at = ?
            WHERE id = ? AND status = 'PREPARING'`,
          )
          .run(errorMessage, updatedAt, batchId);
        if (result.changes) {
          this.storage.recordChange(
            'TERM_ILLUSTRATION_BATCH',
            batchId,
            'FAIL',
            { errorCode: 'SUBMISSION_FAILED' },
            { affectsFileView: false },
          );
        }
      })
      .immediate();
  }

  list(termId: string, limit: number): TermIllustrationListDto {
    const batchRows = this.db
      .prepare(
        `SELECT batch.*,
          CASE WHEN series.deleted_at IS NULL THEN batch.series_id ELSE NULL END AS available_series_id
        FROM term_illustration_batches batch
        LEFT JOIN prompt_series series ON series.id = batch.series_id
        WHERE batch.term_id = ?
        ORDER BY batch.created_at DESC, batch.id DESC
        LIMIT ?`,
      )
      .all(termId, limit) as JsonMap[];
    if (!batchRows.length) return { batches: [] };

    const batchIds = batchRows.map((row) => text(row.id));
    const placeholders = batchIds.map(() => '?').join(', ');
    const runRows = this.db
      .prepare(
        `SELECT link.*, run.model_key AS run_model_key, run.quality AS run_quality,
          run.status AS run_status, run.error_code AS run_error_code, run.error_message AS run_error_message,
          run.started_at AS run_started_at, run.finished_at AS run_finished_at, run.created_at AS run_created_at,
          job.phase AS job_phase, job.progress AS job_progress,
          asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
          asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
          asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM term_illustration_batch_runs link
        JOIN generation_runs run ON run.id = link.generation_run_id
        LEFT JOIN generation_job_links job_link ON job_link.generation_run_id = run.id
        LEFT JOIN background_jobs job ON job.id = job_link.job_id
        LEFT JOIN image_assets asset ON asset.id = run.result_asset_id AND asset.deleted_at IS NULL
        WHERE link.batch_id IN (${placeholders})
        ORDER BY link.batch_id, link.created_at, link.id`,
      )
      .all(...batchIds) as JsonMap[];
    const runsByBatch = new Map<string, TermIllustrationBatchDto['runs']>();
    for (const row of runRows) {
      const assetId = nullableText(row.asset_id);
      const runs = runsByBatch.get(text(row.batch_id)) ?? [];
      runs.push({
        id: text(row.id),
        generationRunId: text(row.generation_run_id),
        status: text(row.run_status) as TermIllustrationBatchDto['runs'][number]['status'],
        phase: nullableText(row.job_phase),
        progress: row.job_progress == null ? null : Number(row.job_progress),
        modelKey: text(row.run_model_key),
        quality: text(row.run_quality) as GenerationQuality,
        asset: assetId
          ? {
              id: assetId,
              kind: text(row.asset_kind) as 'GENERATED' | 'REFERENCE',
              originType: text(row.asset_origin_type),
              width: Number(row.asset_width),
              height: Number(row.asset_height),
              mimeType: text(row.asset_mime_type),
              byteSize: Number(row.asset_byte_size),
              mediaUrl: mediaUrl(assetId),
              createdAt: text(row.asset_created_at),
            }
          : null,
        errorCode: nullableText(row.run_error_code),
        errorMessage: nullableText(row.run_error_message),
        decision: text(row.decision) as TermIllustrationBatchDto['runs'][number]['decision'],
        termMediaLinkId: nullableText(row.term_media_link_id),
        decidedAt: nullableText(row.decided_at),
        startedAt: nullableText(row.run_started_at),
        finishedAt: nullableText(row.run_finished_at),
        createdAt: text(row.run_created_at),
      });
      runsByBatch.set(text(row.batch_id), runs);
    }

    return {
      batches: batchRows.map((row) => ({
        id: text(row.id),
        termId: text(row.term_id),
        termRevisionId: text(row.term_revision_id),
        purpose: text(row.purpose) as TermIllustrationBatchDto['purpose'],
        profileId: text(row.profile_id),
        profileRevision: Number(row.profile_revision),
        promptProfileId: text(row.prompt_profile_id),
        expressionRevisionId: text(row.expression_revision_id),
        modelKey: text(row.model_key),
        quality: text(row.quality) as GenerationQuality,
        seriesId: nullableText(row.available_series_id),
        promptVersionId: nullableText(row.prompt_version_id),
        status: text(row.status) as TermIllustrationBatchDto['status'],
        errorCode: nullableText(row.error_code),
        errorMessage: nullableText(row.error_message),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
        runs: runsByBatch.get(text(row.id)) ?? [],
      })),
    };
  }

  adopt(batchRunId: string, requestedRole: TermIllustrationPurpose): TermIllustrationDecisionResult {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare(
            `SELECT link.decision, batch.term_id, batch.term_revision_id, run.status, run.result_asset_id
            FROM term_illustration_batch_runs link
            JOIN term_illustration_batches batch ON batch.id = link.batch_id
            JOIN generation_runs run ON run.id = link.generation_run_id
            JOIN terms term ON term.id = batch.term_id
            WHERE link.id = ? AND term.archived_at IS NULL
              AND term.editorial_state = 'APPROVED' AND term.current_revision_id = batch.term_revision_id`,
          )
          .get(batchRunId) as JsonMap | undefined;
        if (!row) throw new Error('The term or generated candidate has changed; generate a new candidate');
        if (text(row.decision) !== 'PENDING') throw new Error('This generated candidate has already been decided');
        if (text(row.status) !== 'SUCCEEDED' || !row.result_asset_id) {
          throw new Error('Only a completed generated candidate can be adopted');
        }

        const termId = text(row.term_id);
        const assetId = text(row.result_asset_id);
        this.dictionary.addTermMedia(
          { termId, assetIds: [assetId], preferredRole: requestedRole },
          { returnItems: false },
        );
        const media = this.db
          .prepare(
            `SELECT id, role FROM term_media_links
            WHERE term_id = ? AND image_asset_id = ? AND deleted_at IS NULL`,
          )
          .get(termId, assetId) as JsonMap | undefined;
        if (!media) throw new Error('Generated candidate could not be linked to the term');

        const actualRole = text(media.role) as TermIllustrationPurpose;
        const decision = actualRole === 'COVER' ? ('ADOPTED_COVER' as const) : ('ADOPTED_RELATED' as const);
        const decidedAt = now();
        this.db
          .prepare(
            `UPDATE term_illustration_batch_runs
            SET decision = ?, term_media_link_id = ?, decided_at = ?
            WHERE id = ? AND decision = 'PENDING'`,
          )
          .run(decision, text(media.id), decidedAt, batchRunId);
        this.storage.recordChange(
          'TERM_ILLUSTRATION_RUN',
          batchRunId,
          'ADOPT',
          { termId, assetId, role: actualRole, termMediaLinkId: text(media.id) },
          { affectsFileView: false },
        );
        return { batchRunId, decision, termMediaLinkId: text(media.id) };
      })
      .immediate();
  }

  dismiss(batchRunId: string): TermIllustrationDecisionResult {
    return this.db
      .transaction(() => {
        const decidedAt = now();
        const result = this.db
          .prepare(
            `UPDATE term_illustration_batch_runs
            SET decision = 'DISMISSED', decided_at = ?
            WHERE id = ? AND decision = 'PENDING'`,
          )
          .run(decidedAt, batchRunId);
        if (result.changes !== 1) throw new Error('This generated candidate has already been decided');
        this.storage.recordChange('TERM_ILLUSTRATION_RUN', batchRunId, 'DISMISS', {}, { affectsFileView: false });
        return { batchRunId, decision: 'DISMISSED' as const, termMediaLinkId: null };
      })
      .immediate();
  }
}
