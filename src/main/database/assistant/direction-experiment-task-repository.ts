import { ulid } from 'ulid';
import type {
  CreatorAgentScope,
  DirectionExperimentDelegationInput,
  DirectionExperimentDirectorAuthorizationDto,
  DirectionExperimentDirectorCompletionReportDto,
  DirectionExperimentDirectorTaskDto,
  GenerationTargetInput,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import {
  BackgroundIssueRepository,
  directionExperimentIssueSnapshot,
  directionExperimentStatusFromRuns,
} from '@/main/database/background-issues/background-issue-repository';
import { backgroundIssueIdentityKey } from '@/shared/contracts/background-issue';

interface CreateDirectionExperimentTaskInput {
  scope: CreatorAgentScope;
  sourceAssistantRunId: string;
  batchId: string;
  fixedConstraints: string[];
  directionCount: number;
  targets: GenerationTargetInput[];
  delegation: DirectionExperimentDelegationInput;
}

export interface DirectionExperimentRunRow extends JsonMap {
  batch_id: string;
  slot_id: string;
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface DirectionExperimentRunHydration {
  allByBatch: ReadonlyMap<string, readonly DirectionExperimentRunRow[]>;
  currentByBatch: ReadonlyMap<string, readonly DirectionExperimentRunRow[]>;
  allBySlot: ReadonlyMap<string, readonly DirectionExperimentRunRow[]>;
  currentBySlot: ReadonlyMap<string, readonly DirectionExperimentRunRow[]>;
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

function latestTimestamp(values: Array<string | null | undefined>, fallback: string) {
  return (
    values.filter((value): value is string => Boolean(value)).sort((left, right) => right.localeCompare(left))[0] ??
    fallback
  );
}

export class DirectionExperimentTaskRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly backgroundIssues = new BackgroundIssueRepository(storage),
  ) {}

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
    if (!row) return null;
    const runs = this.loadRunHydration([batchId]);
    return this.hydrateIssues([
      this.dto(row, runs.allByBatch.get(batchId) ?? [], runs.currentByBatch.get(batchId) ?? []),
    ])[0];
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
    const runs = this.loadRunHydration(rows.map((row) => text(row.style_exploration_batch_id)));
    return this.hydrateIssues(
      rows.map((row) => {
        const batchId = text(row.style_exploration_batch_id);
        return this.dto(row, runs.allByBatch.get(batchId) ?? [], runs.currentByBatch.get(batchId) ?? []);
      }),
    );
  }

  listForBatches(
    batchIds: readonly string[],
    runs?: DirectionExperimentRunHydration,
  ): ReadonlyMap<string, DirectionExperimentDirectorTaskDto> {
    if (!batchIds.length || !this.hasStorage()) return new Map();
    const hydratedRuns = runs ?? this.loadRunHydration(batchIds);
    const rows = this.db
      .prepare(
        `SELECT task.*, batch.updated_at AS batch_updated_at
      FROM direction_experiment_director_tasks task
      JOIN style_exploration_batches batch ON batch.id = task.style_exploration_batch_id
      JOIN json_each(?) selected_batch ON selected_batch.value = task.style_exploration_batch_id`,
      )
      .all(JSON.stringify(batchIds)) as JsonMap[];
    const entries = rows.map((row) => {
      const batchId = text(row.style_exploration_batch_id);
      return [
        batchId,
        this.dto(row, hydratedRuns.allByBatch.get(batchId) ?? [], hydratedRuns.currentByBatch.get(batchId) ?? []),
      ] as const;
    });
    const hydratedDtos = this.hydrateIssues(entries.map(([, dto]) => dto));
    return new Map(entries.map(([batchId], index) => [batchId, hydratedDtos[index]]));
  }

  /** Load every historical attempt and its lineage-leaf projection once for a
   * batch set. Style exploration and director-task DTOs share these maps so
   * list hydration never performs SQL per batch or per direction. */
  loadRunHydration(batchIds: readonly string[]): DirectionExperimentRunHydration {
    const allByBatch = new Map<string, DirectionExperimentRunRow[]>();
    const currentByBatch = new Map<string, DirectionExperimentRunRow[]>();
    const allBySlot = new Map<string, DirectionExperimentRunRow[]>();
    const currentBySlot = new Map<string, DirectionExperimentRunRow[]>();
    if (!batchIds.length) return { allByBatch, currentByBatch, allBySlot, currentBySlot };

    const rows = this.db
      .prepare(
        `SELECT slot.batch_id, slot.id AS slot_id,
        run.id, run.status, run.created_at, run.started_at, run.finished_at,
        NOT EXISTS (
          SELECT 1
          FROM background_jobs retry_job
          JOIN generation_job_links retry_run_link ON retry_run_link.job_id = retry_job.id
          JOIN style_exploration_slot_runs retry_slot_link
            ON retry_slot_link.generation_run_id = retry_run_link.generation_run_id
          WHERE retry_job.retry_of_job_id = source_job_link.job_id
            AND retry_slot_link.slot_id = slot.id
        ) AS is_current_attempt
      FROM style_exploration_slots slot
      JOIN json_each(?) selected_batch ON selected_batch.value = slot.batch_id
      JOIN style_exploration_slot_runs link ON link.slot_id = slot.id
      JOIN generation_runs run ON run.id = link.generation_run_id
      LEFT JOIN generation_job_links source_job_link
        ON source_job_link.generation_run_id = run.id
      ORDER BY slot.batch_id, slot.sort_order, slot.id, link.sort_order, link.id`,
      )
      .all(JSON.stringify(batchIds)) as Array<DirectionExperimentRunRow & { is_current_attempt: number }>;

    const append = <K>(map: Map<K, DirectionExperimentRunRow[]>, key: K, row: DirectionExperimentRunRow) => {
      const values = map.get(key);
      if (values) values.push(row);
      else map.set(key, [row]);
    };
    for (const { is_current_attempt: isCurrentAttempt, ...run } of rows) {
      append(allByBatch, text(run.batch_id), run);
      append(allBySlot, text(run.slot_id), run);
      if (Boolean(isCurrentAttempt)) {
        append(currentByBatch, text(run.batch_id), run);
        append(currentBySlot, text(run.slot_id), run);
      }
    }
    return { allByBatch, currentByBatch, allBySlot, currentBySlot };
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
    const batchId = text(row.style_exploration_batch_id);
    const runs = this.loadRunHydration([batchId]);
    return this.hydrateIssues([
      this.dto(row, runs.allByBatch.get(batchId) ?? [], runs.currentByBatch.get(batchId) ?? []),
    ])[0];
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

  private dto(
    row: JsonMap,
    allRuns: readonly DirectionExperimentRunRow[],
    currentRuns: readonly DirectionExperimentRunRow[],
  ): DirectionExperimentDirectorTaskDto {
    const batchId = text(row.style_exploration_batch_id);
    const status = directionExperimentStatusFromRuns(currentRuns);
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
      backgroundIssue: directionExperimentIssueSnapshot(text(row.id), currentRuns, status),
    };
  }

  private hydrateIssues(tasks: DirectionExperimentDirectorTaskDto[]) {
    const snapshots = tasks.flatMap((task) => (task.backgroundIssue ? [task.backgroundIssue] : []));
    const hydrated = this.backgroundIssues.hydrate(snapshots);
    return tasks.map((task) => {
      const snapshot = task.backgroundIssue;
      return snapshot
        ? { ...task, backgroundIssue: hydrated.get(backgroundIssueIdentityKey(snapshot)) ?? snapshot }
        : task;
    });
  }
}

export type { CreateDirectionExperimentTaskInput };
