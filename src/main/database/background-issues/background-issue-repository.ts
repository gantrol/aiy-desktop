import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import type { DirectionExperimentDirectorTaskStatus } from '@/shared/contracts';
import {
  backgroundIssueIdentityKey,
  type BackgroundIssueAcknowledgeInput,
  type BackgroundIssueAcknowledgeResult,
  type BackgroundIssueDto,
  type BackgroundIssueKind,
  type LegacyGenerationDismissalImportInput,
  type LegacyGenerationDismissalImportResult,
} from '@/shared/contracts/background-issue';

const GENERATION_TERMINAL_ERROR_STATUSES = new Set(['FAILED', 'INTERRUPTED']);
const DIRECTOR_TERMINAL_ERROR_STATUSES = new Set<DirectionExperimentDirectorTaskStatus>(['PARTIAL_SUCCESS', 'FAILED']);

function occurrenceId(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nullableText(value: unknown) {
  return value == null ? null : text(value) || null;
}

export function directionExperimentStatusFromRuns(runs: readonly JsonMap[]): DirectionExperimentDirectorTaskStatus {
  if (!runs.length) return 'DELEGATED';
  if (runs.some((run) => text(run.status) === 'RUNNING')) return 'EXECUTING';
  if (runs.some((run) => text(run.status) === 'QUEUED')) return 'PREPARING';
  const completedCount = runs.filter((run) => text(run.status) === 'SUCCEEDED').length;
  if (completedCount === runs.length) return 'SUCCEEDED';
  if (completedCount > 0) return 'PARTIAL_SUCCESS';
  if (runs.every((run) => text(run.status) === 'CANCELLED')) return 'CANCELLED';
  return 'FAILED';
}

export function generationRunIssueSnapshot(row: JsonMap): BackgroundIssueDto | null {
  const status = text(row.status);
  if (!GENERATION_TERMINAL_ERROR_STATUSES.has(status)) return null;
  const subjectId = text(row.id);
  if (!subjectId) return null;
  return {
    kind: 'GENERATION_RUN',
    subjectId,
    occurrenceId: occurrenceId({
      version: 1,
      kind: 'GENERATION_RUN',
      subjectId,
      status,
      finishedAt: nullableText(row.finished_at),
      errorCode: nullableText(row.error_code),
      errorMessage: nullableText(row.error_message),
    }),
    acknowledgedAt: null,
  };
}

export function directionExperimentIssueSnapshot(
  subjectId: string,
  currentRuns: readonly JsonMap[],
  status = directionExperimentStatusFromRuns(currentRuns),
): BackgroundIssueDto | null {
  if (!subjectId || !DIRECTOR_TERMINAL_ERROR_STATUSES.has(status)) return null;
  const runs = currentRuns
    .map((run) => ({
      id: text(run.id),
      status: text(run.status),
      finishedAt: nullableText(run.finished_at),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    kind: 'DIRECTION_EXPERIMENT_DIRECTOR',
    subjectId,
    occurrenceId: occurrenceId({
      version: 1,
      kind: 'DIRECTION_EXPERIMENT_DIRECTOR',
      subjectId,
      status,
      runs,
    }),
    acknowledgedAt: null,
  };
}

export class BackgroundIssueRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  hydrate(snapshots: readonly BackgroundIssueDto[]): ReadonlyMap<string, BackgroundIssueDto> {
    const unique = new Map(snapshots.map((snapshot) => [backgroundIssueIdentityKey(snapshot), snapshot]));
    if (!unique.size) return unique;
    const requested = [...unique.values()].map(({ kind, subjectId, occurrenceId: id }) => ({
      kind,
      subjectId,
      occurrenceId: id,
    }));
    const acknowledgements = this.db
      .prepare(
        `SELECT acknowledgement.issue_kind, acknowledgement.subject_id,
          acknowledgement.occurrence_id, acknowledgement.acknowledged_at
        FROM background_issue_acknowledgements acknowledgement
        JOIN json_each(?) requested
          ON acknowledgement.issue_kind = json_extract(requested.value, '$.kind')
          AND acknowledgement.subject_id = json_extract(requested.value, '$.subjectId')
          AND acknowledgement.occurrence_id = json_extract(requested.value, '$.occurrenceId')`,
      )
      .all(JSON.stringify(requested)) as JsonMap[];
    for (const row of acknowledgements) {
      const key = backgroundIssueIdentityKey({
        kind: text(row.issue_kind) as BackgroundIssueKind,
        subjectId: text(row.subject_id),
        occurrenceId: text(row.occurrence_id),
      });
      const snapshot = unique.get(key);
      if (snapshot) unique.set(key, { ...snapshot, acknowledgedAt: text(row.acknowledged_at) });
    }
    return unique;
  }

  generationIssuesForRows(rows: readonly JsonMap[]) {
    const snapshots = rows.flatMap((row) => {
      const snapshot = generationRunIssueSnapshot(row);
      return snapshot ? [snapshot] : [];
    });
    const hydrated = this.hydrate(snapshots);
    return new Map(
      snapshots.map((snapshot) => [snapshot.subjectId, hydrated.get(backgroundIssueIdentityKey(snapshot)) ?? snapshot]),
    );
  }

  acknowledge(input: BackgroundIssueAcknowledgeInput): BackgroundIssueAcknowledgeResult {
    return this.db.transaction(() => {
      const current = this.currentIssue(input.kind, input.subjectId);
      if (!current) return { status: 'NOT_ACTIONABLE' } as const;
      const hydrated = this.hydrate([current]).get(backgroundIssueIdentityKey(current)) ?? current;
      if (current.occurrenceId !== input.occurrenceId) {
        return { status: 'CONFLICT', currentIssue: hydrated } as const;
      }
      if (hydrated.acknowledgedAt) return { status: 'ALREADY_ACKNOWLEDGED', issue: hydrated } as const;
      const issue = this.insertAcknowledgement(current);
      return { status: 'ACKNOWLEDGED', issue } as const;
    })();
  }

  importLegacyGenerationDismissals(input: LegacyGenerationDismissalImportInput): LegacyGenerationDismissalImportResult {
    const runIds = [...new Set(input.runIds)];
    if (!runIds.length) return { importedRunIds: [], ignoredRunIds: [] };
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT run.id, run.status, run.finished_at, run.error_code, run.error_message
          FROM generation_runs run
          JOIN json_each(?) selected ON selected.value = run.id`,
        )
        .all(JSON.stringify(runIds)) as JsonMap[];
      const snapshots = new Map<string, BackgroundIssueDto>();
      for (const row of rows) {
        const snapshot = generationRunIssueSnapshot(row);
        if (snapshot) snapshots.set(snapshot.subjectId, snapshot);
      }
      const importedRunIds: string[] = [];
      const ignoredRunIds: string[] = [];
      for (const runId of runIds) {
        const snapshot = snapshots.get(runId);
        if (!snapshot) {
          ignoredRunIds.push(runId);
          continue;
        }
        this.insertAcknowledgement(snapshot);
        importedRunIds.push(runId);
      }
      return { importedRunIds, ignoredRunIds };
    })();
  }

  private insertAcknowledgement(snapshot: BackgroundIssueDto) {
    const existing = this.db
      .prepare(
        `SELECT acknowledged_at FROM background_issue_acknowledgements
        WHERE issue_kind = ? AND subject_id = ? AND occurrence_id = ?`,
      )
      .pluck()
      .get(snapshot.kind, snapshot.subjectId, snapshot.occurrenceId);
    if (typeof existing === 'string') return { ...snapshot, acknowledgedAt: existing };

    const id = ulid();
    const acknowledgedAt = now();
    this.db
      .prepare(
        `INSERT INTO background_issue_acknowledgements
        (id, issue_kind, subject_id, occurrence_id, acknowledged_at)
        VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, snapshot.kind, snapshot.subjectId, snapshot.occurrenceId, acknowledgedAt);
    this.storage.recordChange(
      'BACKGROUND_ISSUE_ACKNOWLEDGEMENT',
      id,
      'ACKNOWLEDGE',
      {
        kind: snapshot.kind,
        subjectId: snapshot.subjectId,
        occurrenceId: snapshot.occurrenceId,
      },
      { affectsFileView: false },
    );
    return { ...snapshot, acknowledgedAt };
  }

  private currentIssue(kind: BackgroundIssueKind, subjectId: string) {
    if (kind === 'GENERATION_RUN') return this.currentGenerationIssue(subjectId);
    return this.currentDirectionExperimentIssue(subjectId);
  }

  private currentGenerationIssue(runId: string) {
    const row = this.db
      .prepare(
        `SELECT id, status, finished_at, error_code, error_message
        FROM generation_runs WHERE id = ?`,
      )
      .get(runId) as JsonMap | undefined;
    return row ? generationRunIssueSnapshot(row) : null;
  }

  private currentDirectionExperimentIssue(taskId: string) {
    const task = this.db
      .prepare(
        `SELECT id, style_exploration_batch_id
        FROM direction_experiment_director_tasks WHERE id = ?`,
      )
      .get(taskId) as JsonMap | undefined;
    if (!task) return null;
    const currentRuns = this.db
      .prepare(
        `SELECT run.id, run.status, run.created_at, run.started_at, run.finished_at
        FROM style_exploration_slots slot
        JOIN style_exploration_slot_runs link ON link.slot_id = slot.id
        JOIN generation_runs run ON run.id = link.generation_run_id
        LEFT JOIN generation_job_links source_job_link ON source_job_link.generation_run_id = run.id
        WHERE slot.batch_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM background_jobs retry_job
            JOIN generation_job_links retry_run_link ON retry_run_link.job_id = retry_job.id
            JOIN style_exploration_slot_runs retry_slot_link
              ON retry_slot_link.generation_run_id = retry_run_link.generation_run_id
            WHERE retry_job.retry_of_job_id = source_job_link.job_id
              AND retry_slot_link.slot_id = slot.id
          )
        ORDER BY slot.sort_order, slot.id, link.sort_order, link.id`,
      )
      .all(text(task.style_exploration_batch_id)) as JsonMap[];
    return directionExperimentIssueSnapshot(taskId, currentRuns);
  }
}
