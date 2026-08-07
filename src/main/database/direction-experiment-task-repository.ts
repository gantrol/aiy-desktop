import { ulid } from 'ulid';
import type {
  CreatorAgentScope,
  DirectionExperimentDelegationInput,
  DirectionExperimentDirectorAuthorizationDto,
  DirectionExperimentDirectorCompletionReportDto,
  DirectionExperimentDirectorTaskDto,
  DirectionExperimentDirectorTaskStatus,
  GenerationTargetInput,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

interface CreateDirectionExperimentTaskInput {
  scope: CreatorAgentScope;
  sourceAssistantRunId: string;
  batchId: string;
  fixedConstraints: string[];
  directionCount: number;
  targets: GenerationTargetInput[];
  delegation: DirectionExperimentDelegationInput;
}

interface RunRow extends JsonMap {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const RELATIONSHIP_ACTIONS_NOT_PERFORMED = [
  'FAVORITE',
  'ADOPT',
  'ADD_TO_ALBUM',
  'UPDATE_DICTIONARY',
  'PUBLISH',
] as const;

function parseObject(value: unknown): JsonMap {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

function taskStatus(runs: readonly RunRow[]): DirectionExperimentDirectorTaskStatus {
  if (!runs.length) return 'DELEGATED';
  if (runs.some((run) => run.status === 'RUNNING')) return 'EXECUTING';
  if (runs.some((run) => run.status === 'QUEUED')) return 'PREPARING';
  const completedCount = runs.filter((run) => run.status === 'SUCCEEDED').length;
  if (completedCount === runs.length) return 'SUCCEEDED';
  if (completedCount > 0) return 'PARTIAL_SUCCESS';
  if (runs.every((run) => run.status === 'CANCELLED')) return 'CANCELLED';
  return 'FAILED';
}

function latestTimestamp(values: Array<string | null | undefined>, fallback: string) {
  return (
    values.filter((value): value is string => Boolean(value)).sort((left, right) => right.localeCompare(left))[0] ??
    fallback
  );
}

export class DirectionExperimentTaskRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  create(input: CreateDirectionExperimentTaskInput): DirectionExperimentDirectorTaskDto {
    if (!this.hasStorage()) throw new Error('Direction experiment task storage is unavailable');
    const batch = this.db
      .prepare(
        `SELECT scope_kind, scope_id, source_assistant_run_id
      FROM style_exploration_batches WHERE id = ?`,
      )
      .get(input.batchId) as JsonMap | undefined;
    if (!batch) throw new Error('Direction experiment not found for delegated task');
    if (
      text(batch.scope_kind) !== input.scope.kind ||
      text(batch.scope_id) !== input.scope.id ||
      text(batch.source_assistant_run_id) !== input.sourceAssistantRunId
    ) {
      throw new Error('Delegated task authorization does not match its direction experiment');
    }

    const objective = input.delegation.objective.trim();
    if (!objective) throw new Error('Delegated direction experiment requires an objective');
    const directionCount = Math.max(1, Math.trunc(input.directionCount));
    const targets = input.targets.map((target) => ({ ...target }));
    const maximumRuns = directionCount * targets.reduce((total, target) => total + target.count, 0);
    const authorization: DirectionExperimentDirectorAuthorizationDto = {
      objective,
      fixedConstraints: input.fixedConstraints.map((value) => value.trim()).filter(Boolean),
      directionCount,
      targets,
      maximumRuns,
      deadlineAt: input.delegation.deadlineAt,
      cost: { state: 'UNKNOWN', maximumMinorUnits: null, currency: null },
      remoteScope: [...new Set(input.delegation.remoteScope.map((value) => value.trim()).filter(Boolean))],
      decisions: input.delegation.decisions.map((decision) => ({
        label: decision.label.trim(),
        interpretation: decision.interpretation.trim(),
        impact: decision.impact.trim(),
      })),
      relationshipActionsAllowed: false,
    };
    const id = ulid();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO direction_experiment_director_tasks
      (id, scope_kind, scope_id, source_assistant_run_id, style_exploration_batch_id,
       objective, authorization_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.scope.kind,
        input.scope.id,
        input.sourceAssistantRunId,
        input.batchId,
        objective,
        JSON.stringify(authorization),
        timestamp,
        timestamp,
      );
    this.storage.recordChange('AGENT_TASK', id, 'DELEGATE', {
      kind: 'DIRECTION_EXPERIMENT_DIRECTOR',
      scope: input.scope,
      styleExplorationBatchId: input.batchId,
      authorization,
    });
    return this.require(id);
  }

  getForBatch(batchId: string): DirectionExperimentDirectorTaskDto | null {
    if (!this.hasStorage()) return null;
    const row = this.db
      .prepare(
        `SELECT task.*, batch.updated_at AS batch_updated_at
      FROM direction_experiment_director_tasks task
      JOIN style_exploration_batches batch ON batch.id = task.style_exploration_batch_id
      WHERE task.style_exploration_batch_id = ?`,
      )
      .get(batchId) as JsonMap | undefined;
    return row ? this.dto(row) : null;
  }

  list(limit = 50): DirectionExperimentDirectorTaskDto[] {
    if (!this.hasStorage()) return [];
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `SELECT task.*, batch.updated_at AS batch_updated_at
      FROM direction_experiment_director_tasks task
      JOIN style_exploration_batches batch ON batch.id = task.style_exploration_batch_id
      ORDER BY task.created_at DESC, task.id DESC LIMIT ?`,
      )
      .all(safeLimit) as JsonMap[];
    return rows.map((row) => this.dto(row));
  }

  private require(id: string) {
    const row = this.db
      .prepare(
        `SELECT task.*, batch.updated_at AS batch_updated_at
      FROM direction_experiment_director_tasks task
      JOIN style_exploration_batches batch ON batch.id = task.style_exploration_batch_id
      WHERE task.id = ?`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Delegated direction experiment task not found');
    return this.dto(row);
  }

  private hasStorage() {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'direction_experiment_director_tasks'`,
        )
        .get(),
    );
  }

  private dto(row: JsonMap): DirectionExperimentDirectorTaskDto {
    const batchId = text(row.style_exploration_batch_id);
    const allRuns = this.allRuns(batchId);
    const currentRuns = this.currentAttemptRuns(batchId);
    const status = taskStatus(currentRuns);
    const completedCount = currentRuns.filter((run) => run.status === 'SUCCEEDED').length;
    const failedCount = currentRuns.filter((run) => run.status === 'FAILED').length;
    const cancelledCount = currentRuns.filter((run) => run.status === 'CANCELLED').length;
    const interruptedCount = currentRuns.filter((run) => run.status === 'INTERRUPTED').length;
    const activeCount = currentRuns.filter((run) => run.status === 'QUEUED' || run.status === 'RUNNING').length;
    const terminal = ['SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'].includes(status);
    const authorization = parseObject(row.authorization_json) as unknown as DirectionExperimentDirectorAuthorizationDto;
    const completionReport: DirectionExperimentDirectorCompletionReportDto | null = terminal
      ? {
          authorizedRunCount: authorization.maximumRuns,
          submittedRunCount: allRuns.length,
          retryRunCount: Math.max(0, allRuns.length - authorization.maximumRuns),
          outputCount: completedCount,
          failedCount,
          cancelledCount,
          interruptedCount,
          knownCostMinorUnits: null,
          currency: null,
          relationshipActionsPerformed: [],
          relationshipActionsNotPerformed: [...RELATIONSHIP_ACTIONS_NOT_PERFORMED],
        }
      : null;
    const createdAt = text(row.created_at);
    const observedAt = latestTimestamp(
      allRuns.flatMap((run) => [
        text(run.finished_at) || null,
        text(run.started_at) || null,
        text(run.created_at) || null,
      ]),
      text(row.batch_updated_at) || text(row.updated_at) || createdAt,
    );
    const updatedAt = latestTimestamp([text(row.updated_at), text(row.batch_updated_at), observedAt], createdAt);
    const finishedAt = terminal
      ? latestTimestamp(
          currentRuns.map((run) => text(run.finished_at) || null),
          updatedAt,
        )
      : null;
    return {
      id: text(row.id),
      kind: 'DIRECTION_EXPERIMENT_DIRECTOR',
      scope: {
        kind: text(row.scope_kind) as CreatorAgentScope['kind'],
        id: text(row.scope_id),
      },
      sourceAssistantRunId: text(row.source_assistant_run_id),
      batchId,
      status,
      objective: text(row.objective),
      authorization,
      runIds: allRuns.map((run) => text(run.id)),
      completedCount,
      failedCount,
      cancelledCount,
      interruptedCount,
      activeCount,
      totalCount: currentRuns.length,
      completionReport,
      createdAt,
      updatedAt,
      finishedAt,
    };
  }

  private allRuns(batchId: string): RunRow[] {
    return this.db
      .prepare(
        `SELECT run.id, run.status, run.created_at, run.started_at, run.finished_at
      FROM style_exploration_slots slot
      JOIN style_exploration_slot_runs link ON link.slot_id = slot.id
      JOIN generation_runs run ON run.id = link.generation_run_id
      WHERE slot.batch_id = ?
      ORDER BY slot.sort_order, link.sort_order, link.id`,
      )
      .all(batchId) as RunRow[];
  }

  /** Retries replace their source at one logical output position. */
  private currentAttemptRuns(batchId: string): RunRow[] {
    return this.db
      .prepare(
        `SELECT run.id, run.status, run.created_at, run.started_at, run.finished_at
      FROM style_exploration_slots slot
      JOIN style_exploration_slot_runs link ON link.slot_id = slot.id
      JOIN generation_runs run ON run.id = link.generation_run_id
      LEFT JOIN generation_job_links source_job_link
        ON source_job_link.generation_run_id = run.id
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
      ORDER BY slot.sort_order, link.sort_order, link.id`,
      )
      .all(batchId) as RunRow[];
  }
}

export type { CreateDirectionExperimentTaskInput };
