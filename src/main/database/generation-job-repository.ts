import { ulid } from 'ulid';
import type { GenerationErrorDetailsDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING']);
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

export interface GenerationProviderAcceptance {
  providerKey?: string | null;
  providerRequestId: string;
  checkpoint?: unknown;
}

export interface RecoverableGenerationRun {
  runId: string;
  jobId: string;
  rootJobId: string;
  retryOfJobId: string | null;
  attemptId: string;
  status: 'INTERRUPTED';
  phase: string;
  progress: number | null;
  statusMessage: string | null;
  providerKey: string | null;
  providerRequestId: string | null;
  checkpoint: unknown;
  lastHeartbeatAt: string | null;
  errorCode: string | null;
  recoveryMode: 'RECONCILE' | 'RETRY';
}

export interface GenerationJobState {
  runId: string;
  jobId: string;
  rootJobId: string;
  retryOfJobId: string | null;
  attemptId: string;
  desiredState: string;
  revision: number;
  status: string;
  phase: string;
  progress: number | null;
  statusMessage: string | null;
  providerKey: string | null;
  providerRequestId: string | null;
  checkpoint: unknown;
  lastHeartbeatAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function phaseForStatus(status: string) {
  if (status === 'QUEUED') return 'QUEUED';
  if (status === 'RUNNING') return 'GENERATING';
  return status;
}

function clampProgress(progress: number | null | undefined) {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(1, progress));
}

function jsonValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export class GenerationJobRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  /**
   * Attaches the durable lifecycle record to a generation run. Callers that
   * create runs invoke this inside the same transaction as the run insert.
   */
  createForRun(runId: string, retryOfRunId?: string): GenerationJobState {
    const existing = this.getForRun(runId);
    if (existing) return existing;

    const run = this.db.prepare('SELECT * FROM generation_runs WHERE id = ?').get(runId) as JsonMap | undefined;
    if (!run) throw new Error('Generation run not found');
    const retryOf = retryOfRunId
      ? (this.db
          .prepare(
            `SELECT job.* FROM background_jobs job
          JOIN generation_job_links link ON link.job_id = job.id
          WHERE link.generation_run_id = ? AND job.kind = 'GENERATION'`,
          )
          .get(retryOfRunId) as JsonMap | undefined)
      : undefined;
    if (retryOfRunId && !retryOf) throw new Error('Generation retry source job not found');

    const jobId = ulid();
    const attemptId = ulid();
    const status = text(run.status) || 'QUEUED';
    const phase = phaseForStatus(status);
    const createdAt = text(run.created_at) || now();
    const updatedAt = text(run.finished_at) || text(run.started_at) || createdAt;
    const progress = status === 'SUCCEEDED' ? 1 : null;
    const rootJobId = retryOf ? text(retryOf.root_job_id) : jobId;
    const retryOfJobId = retryOf ? text(retryOf.id) : null;

    this.db
      .prepare(
        `INSERT INTO background_jobs (
      id, kind, desired_state, status, phase, progress, status_message, priority,
      not_before, revision, root_job_id, retry_of_job_id, provider_key,
      provider_request_id, checkpoint_json, last_heartbeat_at, error_code,
      error_message, started_at, finished_at, created_at, updated_at
    ) VALUES (?, 'GENERATION', 'RUN', ?, ?, ?, NULL, 0, NULL, 1, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobId,
        status,
        phase,
        progress,
        rootJobId,
        retryOfJobId,
        run.finished_at ?? run.started_at ?? null,
        run.error_code ?? null,
        run.error_message ?? null,
        run.started_at ?? null,
        run.finished_at ?? null,
        createdAt,
        updatedAt,
      );
    this.db
      .prepare(
        `INSERT INTO generation_job_links (generation_run_id, job_id)
      VALUES (?, ?)`,
      )
      .run(runId, jobId);
    this.db
      .prepare(
        `INSERT INTO background_job_attempts (
      id, job_id, attempt_no, recovery_mode, retryable, worker_id, lease_expires_at,
      status, phase, progress, status_message, provider_key, provider_request_id,
      checkpoint_json, last_heartbeat_at, error_code, error_message, started_at,
      finished_at, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attemptId,
        jobId,
        retryOf ? 'RETRY' : 'NEW',
        ['FAILED', 'INTERRUPTED'].includes(status) ? 1 : 0,
        status,
        phase,
        progress,
        run.finished_at ?? run.started_at ?? null,
        run.error_code ?? null,
        run.error_message ?? null,
        run.started_at ?? null,
        run.finished_at ?? null,
        createdAt,
        updatedAt,
      );
    if (run.result_asset_id) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO generation_outputs
        (id, job_id, attempt_id, output_slot, image_asset_id, provider_output_id, created_at)
        VALUES (?, ?, ?, 'primary', ?, NULL, ?)`,
        )
        .run(ulid(), jobId, attemptId, run.result_asset_id, text(run.finished_at) || createdAt);
    }
    this.appendEvent(
      jobId,
      attemptId,
      retryOf ? 'RETRY_CREATED' : 'CREATED',
      phase,
      progress,
      null,
      {
        runId,
        retryOfRunId: retryOfRunId ?? null,
      },
      createdAt,
    );
    return this.getForRun(runId)!;
  }

  attachMissingRuns() {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT run.id FROM generation_runs run
        LEFT JOIN generation_job_links link ON link.generation_run_id = run.id
        WHERE link.job_id IS NULL ORDER BY run.created_at, run.id`,
        )
        .all() as Array<{ id: string }>;
      for (const row of rows) this.createForRun(row.id);
      return rows.length;
    })();
  }

  getForRun(runId: string): GenerationJobState | null {
    const row = this.db
      .prepare(
        `SELECT job.*, link.generation_run_id, attempt.id AS attempt_id
      FROM background_jobs job
      JOIN generation_job_links link ON link.job_id = job.id
      JOIN background_job_attempts attempt ON attempt.id = (
        SELECT candidate.id FROM background_job_attempts candidate
        WHERE candidate.job_id = job.id
        ORDER BY candidate.attempt_no DESC LIMIT 1
      )
      WHERE link.generation_run_id = ? AND job.kind = 'GENERATION'`,
      )
      .get(runId) as JsonMap | undefined;
    return row ? this.state(row) : null;
  }

  markPhase(runId: string, phase: string, progress?: number | null, statusMessage?: string | null): GenerationJobState {
    return this.db.transaction(() => {
      const state = this.getForRun(runId) ?? this.createForRun(runId);
      const recovering = state.status === 'INTERRUPTED' && phase === 'RECOVERING';
      if (TERMINAL_STATUSES.has(state.status) && !recovering) return state;
      const changedAt = now();
      const nextProgress = progress === undefined ? state.progress : clampProgress(progress);
      const nextMessage = statusMessage === undefined ? state.statusMessage : statusMessage;
      const status = phase === 'QUEUED' ? 'QUEUED' : 'RUNNING';
      const desiredState = phase === 'CANCELLING' ? 'CANCEL' : 'RUN';
      const startedAt = status === 'RUNNING' ? (state.startedAt ?? changedAt) : state.startedAt;
      if (recovering) {
        this.db
          .prepare(
            `UPDATE generation_runs SET status = 'RUNNING', error_code = NULL,
          error_message = NULL, finished_at = NULL WHERE id = ?`,
          )
          .run(runId);
        this.db
          .prepare(
            `UPDATE background_jobs SET status = 'RUNNING', desired_state = 'RUN',
          error_code = NULL,
          error_message = NULL, finished_at = NULL WHERE id = ?`,
          )
          .run(state.jobId);
        this.db
          .prepare(
            `UPDATE background_job_attempts SET status = 'RUNNING',
          recovery_mode = CASE WHEN provider_request_id IS NULL THEN 'RETRY' ELSE 'RECONCILE' END,
          retryable = 1, worker_id = NULL, lease_expires_at = NULL, error_code = NULL,
          error_message = NULL, finished_at = NULL WHERE id = ?`,
          )
          .run(state.attemptId);
      }
      this.db
        .prepare(
          `UPDATE generation_runs SET status = ?, started_at = COALESCE(started_at, ?)
        WHERE id = ?`,
        )
        .run(status, startedAt, runId);
      this.db
        .prepare(
          `UPDATE background_jobs SET desired_state = ?, status = ?, phase = ?, progress = ?,
        status_message = ?, last_heartbeat_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?
        , revision = revision + 1
        WHERE id = ?`,
        )
        .run(desiredState, status, phase, nextProgress, nextMessage, changedAt, startedAt, changedAt, state.jobId);
      this.db
        .prepare(
          `UPDATE background_job_attempts SET status = ?, phase = ?, progress = ?,
        status_message = ?, last_heartbeat_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ?`,
        )
        .run(status, phase, nextProgress, nextMessage, changedAt, startedAt, changedAt, state.attemptId);
      this.appendEvent(state.jobId, state.attemptId, 'PHASE_CHANGED', phase, nextProgress, nextMessage, {}, changedAt);
      return this.getForRun(runId)!;
    })();
  }

  recordProviderAccepted(runId: string, input: GenerationProviderAcceptance): GenerationJobState {
    const providerRequestId = input.providerRequestId.trim();
    if (!providerRequestId) throw new Error('Provider request id is empty');
    return this.db.transaction(() => {
      const state = this.getForRun(runId) ?? this.createForRun(runId);
      if (TERMINAL_STATUSES.has(state.status)) return state;
      const acceptedAt = now();
      const providerKey = input.providerKey?.trim() || state.providerKey;
      const checkpoint = input.checkpoint === undefined ? jsonValue(state.checkpoint) : jsonValue(input.checkpoint);
      const startedAt = state.startedAt ?? acceptedAt;
      this.db
        .prepare(
          `UPDATE generation_runs SET status = 'RUNNING',
        started_at = COALESCE(started_at, ?) WHERE id = ?`,
        )
        .run(startedAt, runId);
      this.db
        .prepare(
          `UPDATE background_jobs SET desired_state = 'RUN', status = 'RUNNING', provider_key = ?,
        provider_request_id = ?, checkpoint_json = ?, last_heartbeat_at = ?,
        started_at = COALESCE(started_at, ?), updated_at = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(providerKey, providerRequestId, checkpoint, acceptedAt, startedAt, acceptedAt, state.jobId);
      this.db
        .prepare(
          `UPDATE background_job_attempts SET status = 'RUNNING', provider_key = ?,
        provider_request_id = ?, checkpoint_json = ?, last_heartbeat_at = ?,
        started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`,
        )
        .run(providerKey, providerRequestId, checkpoint, acceptedAt, startedAt, acceptedAt, state.attemptId);
      this.appendEvent(
        state.jobId,
        state.attemptId,
        'PROVIDER_ACCEPTED',
        state.phase,
        state.progress,
        state.statusMessage,
        { providerKey, providerRequestId },
        acceptedAt,
      );
      return this.getForRun(runId)!;
    })();
  }

  saveCheckpoint(runId: string, checkpoint: unknown, progress?: number | null): GenerationJobState {
    return this.db.transaction(() => {
      const state = this.getForRun(runId) ?? this.createForRun(runId);
      if (TERMINAL_STATUSES.has(state.status)) return state;
      const changedAt = now();
      const checkpointJson = jsonValue(checkpoint);
      const nextProgress = progress === undefined ? state.progress : clampProgress(progress);
      this.db
        .prepare(
          `UPDATE background_jobs SET checkpoint_json = ?, progress = ?,
        last_heartbeat_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(checkpointJson, nextProgress, changedAt, changedAt, state.jobId);
      this.db
        .prepare(
          `UPDATE background_job_attempts SET checkpoint_json = ?, progress = ?,
        last_heartbeat_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(checkpointJson, nextProgress, changedAt, changedAt, state.attemptId);
      this.appendEvent(
        state.jobId,
        state.attemptId,
        'CHECKPOINT_SAVED',
        state.phase,
        nextProgress,
        state.statusMessage,
        {},
        changedAt,
      );
      return this.getForRun(runId)!;
    })();
  }

  heartbeat(runId: string, progress?: number | null): GenerationJobState {
    const state = this.getForRun(runId) ?? this.createForRun(runId);
    if (TERMINAL_STATUSES.has(state.status)) return state;
    const heartbeatAt = now();
    const nextProgress = progress === undefined ? state.progress : clampProgress(progress);
    this.db
      .prepare(
        `UPDATE background_jobs SET progress = ?, last_heartbeat_at = ?, updated_at = ?,
      revision = revision + 1
      WHERE id = ?`,
      )
      .run(nextProgress, heartbeatAt, heartbeatAt, state.jobId);
    this.db
      .prepare(
        `UPDATE background_job_attempts SET progress = ?, last_heartbeat_at = ?, updated_at = ?
      WHERE id = ?`,
      )
      .run(nextProgress, heartbeatAt, heartbeatAt, state.attemptId);
    return this.getForRun(runId)!;
  }

  markStatus(
    runId: string,
    status: string,
    errorMessage?: string,
    errorCode?: string,
    errorDetails?: GenerationErrorDetailsDto,
  ): GenerationJobState {
    if (!ACTIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status)) {
      throw new Error(`Unsupported generation status: ${status}`);
    }
    return this.db.transaction(() => {
      const state = this.getForRun(runId) ?? this.createForRun(runId);
      if (TERMINAL_STATUSES.has(state.status)) return state;
      const changedAt = now();
      const startedAt = status === 'RUNNING' ? (state.startedAt ?? changedAt) : state.startedAt;
      const finishedAt = TERMINAL_STATUSES.has(status) ? changedAt : null;
      const nextErrorCode = status === 'INTERRUPTED' ? (errorCode ?? 'APPLICATION_CLOSED') : (errorCode ?? null);
      const nextErrorMessage = errorMessage ?? null;
      const phase = TERMINAL_STATUSES.has(status) ? status : status === 'QUEUED' ? 'QUEUED' : state.phase;
      const progress = status === 'SUCCEEDED' ? 1 : state.progress;
      const retryable = status === 'FAILED' || status === 'INTERRUPTED' ? (errorDetails?.retryable ?? true) : false;

      this.db
        .prepare(
          `UPDATE generation_runs SET status = ?, error_code = ?, error_message = ?,
        started_at = COALESCE(started_at, ?), finished_at = ? WHERE id = ?`,
        )
        .run(status, nextErrorCode, nextErrorMessage, startedAt, finishedAt, runId);
      this.db
        .prepare(
          `UPDATE background_jobs SET desired_state = ?, status = ?, phase = ?, progress = ?,
        status_message = NULL, error_code = ?, error_message = ?,
        started_at = COALESCE(started_at, ?), finished_at = ?, updated_at = ?,
        revision = revision + 1 WHERE id = ?`,
        )
        .run(
          status === 'CANCELLED' ? 'CANCEL' : 'RUN',
          status,
          phase,
          progress,
          nextErrorCode,
          nextErrorMessage,
          startedAt,
          finishedAt,
          changedAt,
          state.jobId,
        );
      this.db
        .prepare(
          `UPDATE background_job_attempts SET status = ?, phase = ?, progress = ?,
        retryable = ?, worker_id = NULL, lease_expires_at = NULL,
        status_message = NULL, error_code = ?, error_message = ?,
        started_at = COALESCE(started_at, ?), finished_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          status,
          phase,
          progress,
          retryable ? 1 : 0,
          nextErrorCode,
          nextErrorMessage,
          startedAt,
          finishedAt,
          changedAt,
          state.attemptId,
        );
      this.appendEvent(
        state.jobId,
        state.attemptId,
        status,
        phase,
        progress,
        null,
        { errorCode: nextErrorCode, ...(errorDetails ? { errorDetails } : {}) },
        changedAt,
      );
      return this.getForRun(runId)!;
    })();
  }

  outputAssetId(runId: string, outputSlot = 'primary'): string | null {
    const row = this.db
      .prepare(
        `SELECT output.image_asset_id FROM generation_outputs output
      JOIN generation_job_links link ON link.job_id = output.job_id
      WHERE link.generation_run_id = ? AND output.output_slot = ?`,
      )
      .get(runId, outputSlot) as JsonMap | undefined;
    return row ? text(row.image_asset_id) : null;
  }

  recordOutput(runId: string, assetId: string, providerOutputId?: string | null, outputSlot = 'primary') {
    const state = this.getForRun(runId) ?? this.createForRun(runId);
    const existing = this.outputAssetId(runId, outputSlot);
    if (existing) {
      if (existing !== assetId) throw new Error('Generation output slot is already committed');
      return existing;
    }
    this.db
      .prepare(
        `INSERT INTO generation_outputs
      (id, job_id, attempt_id, output_slot, image_asset_id, provider_output_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ulid(), state.jobId, state.attemptId, outputSlot, assetId, providerOutputId ?? null, now());
    return assetId;
  }

  markOutputSucceeded(runId: string, assetId: string, providerOutputId?: string | null): GenerationJobState {
    return this.db.transaction(() => {
      const state = this.getForRun(runId) ?? this.createForRun(runId);
      const existing = this.outputAssetId(runId);
      if (existing && existing !== assetId) throw new Error('Generation output is already committed');
      if (!existing) this.recordOutput(runId, assetId, providerOutputId);
      if (state.status === 'SUCCEEDED') return this.getForRun(runId)!;
      const finishedAt = now();
      this.db
        .prepare(
          `UPDATE generation_runs SET status = 'SUCCEEDED', result_asset_id = ?,
        error_code = NULL, error_message = NULL, finished_at = ? WHERE id = ?`,
        )
        .run(assetId, finishedAt, runId);
      this.db
        .prepare(
          `UPDATE background_jobs SET desired_state = 'RUN',
        status = 'SUCCEEDED', phase = 'SUCCEEDED',
        progress = 1, status_message = NULL, error_code = NULL, error_message = NULL,
        finished_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(finishedAt, finishedAt, state.jobId);
      this.db
        .prepare(
          `UPDATE background_job_attempts SET status = 'SUCCEEDED', phase = 'SUCCEEDED',
        progress = 1, retryable = 0, worker_id = NULL, lease_expires_at = NULL,
        status_message = NULL, error_code = NULL, error_message = NULL,
        finished_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(finishedAt, finishedAt, state.attemptId);
      this.appendEvent(
        state.jobId,
        state.attemptId,
        'SUCCEEDED',
        'SUCCEEDED',
        1,
        null,
        { assetId, providerOutputId: providerOutputId ?? null },
        finishedAt,
      );
      return this.getForRun(runId)!;
    })();
  }

  listRecoverable(): RecoverableGenerationRun[] {
    const rows = this.db
      .prepare(
        `SELECT job.*, link.generation_run_id, attempt.id AS attempt_id
      FROM background_jobs job
      JOIN generation_job_links link ON link.job_id = job.id
      JOIN background_job_attempts attempt ON attempt.id = (
        SELECT candidate.id FROM background_job_attempts candidate
        WHERE candidate.job_id = job.id
        ORDER BY candidate.attempt_no DESC LIMIT 1
      )
      WHERE job.kind = 'GENERATION' AND job.desired_state = 'RUN' AND job.status = 'INTERRUPTED'
        AND NOT EXISTS (
          SELECT 1 FROM background_jobs retry WHERE retry.retry_of_job_id = job.id
        )
      ORDER BY job.updated_at, job.id`,
      )
      .all() as JsonMap[];
    return rows.map((row) => {
      const state = this.state(row);
      return {
        runId: state.runId,
        jobId: state.jobId,
        rootJobId: state.rootJobId,
        retryOfJobId: state.retryOfJobId,
        attemptId: state.attemptId,
        status: 'INTERRUPTED' as const,
        phase: state.phase,
        progress: state.progress,
        statusMessage: state.statusMessage,
        providerKey: state.providerKey,
        providerRequestId: state.providerRequestId,
        checkpoint: state.checkpoint,
        lastHeartbeatAt: state.lastHeartbeatAt,
        errorCode: state.errorCode,
        recoveryMode: state.providerRequestId ? ('RECONCILE' as const) : ('RETRY' as const),
      };
    });
  }

  private appendEvent(
    jobId: string,
    attemptId: string | null,
    eventType: string,
    phase: string | null,
    progress: number | null,
    statusMessage: string | null,
    payload: unknown,
    createdAt = now(),
  ) {
    const sequence = Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
      FROM background_job_events WHERE job_id = ?`,
          )
          .get(jobId) as JsonMap
      ).sequence,
    );
    this.db
      .prepare(
        `INSERT INTO background_job_events
      (id, job_id, attempt_id, sequence, event_type, phase, progress, status_message, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        jobId,
        attemptId,
        sequence,
        eventType,
        phase,
        progress,
        statusMessage,
        JSON.stringify(payload),
        createdAt,
      );
  }

  private state(row: JsonMap): GenerationJobState {
    return {
      runId: text(row.generation_run_id),
      jobId: text(row.id),
      rootJobId: text(row.root_job_id),
      retryOfJobId: row.retry_of_job_id ? text(row.retry_of_job_id) : null,
      attemptId: text(row.attempt_id),
      desiredState: text(row.desired_state),
      revision: Number(row.revision),
      status: text(row.status),
      phase: text(row.phase),
      progress: row.progress == null ? null : Number(row.progress),
      statusMessage: row.status_message ? text(row.status_message) : null,
      providerKey: row.provider_key ? text(row.provider_key) : null,
      providerRequestId: row.provider_request_id ? text(row.provider_request_id) : null,
      checkpoint: parsedJson(row.checkpoint_json),
      lastHeartbeatAt: row.last_heartbeat_at ? text(row.last_heartbeat_at) : null,
      errorCode: row.error_code ? text(row.error_code) : null,
      errorMessage: row.error_message ? text(row.error_message) : null,
      startedAt: row.started_at ? text(row.started_at) : null,
      finishedAt: row.finished_at ? text(row.finished_at) : null,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  }
}
