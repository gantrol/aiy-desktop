import { ulid } from 'ulid';
import type {
  CreatorAgentScope,
  DirectionExperimentDelegationInput,
  GenerationTargetInput,
  PromptCommonInputDto,
  StyleExplorationBatchDto,
  StyleExplorationStartInput,
  StyleExplorationSlotDto,
  StyleExplorationStatus,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { DirectionExperimentTaskRepository } from '@/main/database/direction-experiment-task-repository';
import { type JsonMap, now, strings, text } from '@/main/database/values';

interface RunProjection {
  id: string;
  status: string;
}

interface StatusProjection {
  status: StyleExplorationStatus;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  interruptedCount: number;
  activeCount: number;
  totalCount: number;
}

export interface PreparedStyleExplorationSlot {
  label: string;
  rationale: string;
  variableAxis: string;
  risk: string;
  userInstruction: string;
  seriesId: string;
  versionId: string;
  runIds: string[];
}

export interface CreateStyleExplorationFromRunsInput {
  scope: CreatorAgentScope;
  sourceAssistantRunId: string;
  commonConstraints: string[];
  slots: PreparedStyleExplorationSlot[];
  targets?: GenerationTargetInput[];
  delegation?: DirectionExperimentDelegationInput;
}

function statusProjection(runs: readonly RunProjection[]): StatusProjection {
  const totalCount = runs.length;
  if (totalCount === 0) throw new Error('Style exploration direction has no generation runs');
  const completedCount = runs.filter((run) => run.status === 'SUCCEEDED').length;
  const failedCount = runs.filter((run) => run.status === 'FAILED').length;
  const cancelledCount = runs.filter((run) => run.status === 'CANCELLED').length;
  const interruptedCount = runs.filter((run) => run.status === 'INTERRUPTED').length;
  const activeCount = runs.filter((run) => run.status === 'QUEUED' || run.status === 'RUNNING').length;
  const hasRunning = runs.some((run) => run.status === 'RUNNING');
  const hasQueued = runs.some((run) => run.status === 'QUEUED');

  let status: StyleExplorationStatus;
  if (totalCount > 0 && completedCount === totalCount) {
    status = 'SUCCEEDED';
  } else if (completedCount > 0) {
    // A successful output is immediately useful even while siblings are still
    // running, cancelled, or failed. PARTIAL therefore always means that at
    // least one concrete output exists; it is not a synonym for partial work.
    status = 'PARTIAL';
  } else if (hasRunning) {
    status = 'RUNNING';
  } else if (hasQueued) {
    status = 'QUEUED';
  } else if (runs.length > 0 && runs.every((run) => run.status === 'CANCELLED')) {
    status = 'CANCELLED';
  } else if (runs.some((run) => run.status === 'FAILED')) {
    status = 'FAILED';
  } else if (runs.some((run) => run.status === 'INTERRUPTED')) {
    status = 'INTERRUPTED';
  } else if (runs.some((run) => run.status === 'CANCELLED')) {
    status = 'CANCELLED';
  } else status = 'FAILED';

  return {
    status,
    completedCount,
    failedCount,
    cancelledCount,
    interruptedCount,
    activeCount,
    totalCount,
  };
}

function normalizedConstraints(values: readonly string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function objectArray(value: unknown): JsonMap[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class StyleExplorationRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly directorTasks = new DirectionExperimentTaskRepository(storage),
  ) {}

  private get db() {
    return this.storage.db;
  }

  /**
   * Enforce the proposal as the authorization boundary before any generation
   * rows are prepared. Renderer callers may choose a subset of directions, but
   * cannot replace prompts, context material, references, canvas, or targets.
   */
  validateStart(input: StyleExplorationStartInput, promptSnapshots: readonly PromptCommonInputDto[]): void {
    if (promptSnapshots.length !== input.slots.length) throw new Error('Direction prompt snapshot count is invalid');
    this.assertScopeTarget(input.scope);
    const row = this.db
      .prepare(
        `SELECT run.scope_kind, run.scope_id, run.status,
        run.request_json, proposal.result_json,
        proposal.status AS proposal_status
      FROM assistant_runs run
      JOIN assistant_proposals proposal ON proposal.assistant_run_id = run.id
      WHERE run.id = ?`,
      )
      .get(input.sourceAssistantRunId) as JsonMap | undefined;
    if (!row) throw new Error('Assistant run not found');
    if (text(row.scope_kind) !== input.scope.kind || text(row.scope_id) !== input.scope.id) {
      throw new Error('Assistant run belongs to a different creation scope');
    }
    if (text(row.status) !== 'SUCCEEDED') throw new Error('Assistant run has no completed direction proposal');
    if (!['READY', 'ADOPTED'].includes(text(row.proposal_status))) {
      throw new Error('Assistant proposal is no longer available for an experiment');
    }

    const request = this.parseObject(row.request_json);
    const result = this.parseObject(row.result_json);
    const proposedDirections = objectArray(result.directions);
    const usedDirectionIndexes = new Set<number>();
    for (const slot of input.slots) {
      const match = proposedDirections.findIndex(
        (direction, index) =>
          !usedDirectionIndexes.has(index) &&
          text(direction.label).trim() === slot.label.trim() &&
          text(direction.prompt).trim() === slot.userInstruction.trim() &&
          text(direction.rationale).trim() === slot.rationale.trim() &&
          text(direction.variableAxis).trim() === slot.variableAxis.trim() &&
          text(direction.risk).trim() === slot.risk.trim(),
      );
      if (match < 0) throw new Error('Direction experiment contains an unapproved proposal');
      usedDirectionIndexes.add(match);
    }

    if (
      !sameStrings(
        normalizedConstraints(input.commonConstraints),
        normalizedConstraints(strings(result.sharedConstraints)),
      )
    ) {
      throw new Error('Direction experiment fixed constraints differ from the approved proposal');
    }

    if (input.delegation) {
      if (!input.delegation.objective.trim()) throw new Error('Delegated direction experiment requires an objective');
      if (!input.delegation.remoteScope.map((value) => value.trim()).filter(Boolean).length) {
        throw new Error('Delegated direction experiment must disclose its remote send scope');
      }
      if (input.delegation.deadlineAt && !Number.isFinite(Date.parse(input.delegation.deadlineAt))) {
        throw new Error('Delegated direction experiment deadline is invalid');
      }
      const proposedDecisions = objectArray(result.assumptions).map((assumption) => ({
        label: text(assumption.label).trim(),
        interpretation: text(assumption.interpretation).trim(),
        impact: text(assumption.impact).trim(),
      }));
      const acceptedDecisions = input.delegation.decisions.map((decision) => ({
        label: decision.label.trim(),
        interpretation: decision.interpretation.trim(),
        impact: decision.impact.trim(),
      }));
      if (canonicalJson(proposedDecisions) !== canonicalJson(acceptedDecisions)) {
        throw new Error('Resolve every proposal ambiguity before delegating the experiment');
      }
    }

    const frozenTargets = objectArray(request.generationTargets).map((target) => ({
      modelKey: text(target.modelKey),
      count: Number(target.count),
      quality: text(target.quality),
    }));
    const requestedTargets = input.targets.map((target) => ({
      modelKey: target.modelKey,
      count: target.count,
      quality: target.quality,
    }));
    if (canonicalJson(frozenTargets) !== canonicalJson(requestedTargets)) {
      throw new Error('Generation targets changed after the assistant proposal was frozen');
    }

    const frozenTermIds = objectArray(request.directTerms).map((term) => text(term.stableId));
    const frozenReferences = objectArray(request.referenceAssets).map((asset) => text(asset.assetId));
    const frozenRecipes = objectArray(request.recipes).map((recipe) => ({
      paletteId: text(recipe.stableId),
      paletteRevisionId: text(recipe.revisionId),
      parameterValues:
        recipe.parameterValues && typeof recipe.parameterValues === 'object' && !Array.isArray(recipe.parameterValues)
          ? recipe.parameterValues
          : {},
      promptLocale: text(recipe.promptLocale),
    }));
    const frozenCanvasPresetKey = request.canvasPresetKey === null ? null : text(request.canvasPresetKey);
    const frozenCanvasWidth =
      request.canvasWidth === null || request.canvasWidth === undefined ? null : Number(request.canvasWidth);
    const frozenCanvasHeight =
      request.canvasHeight === null || request.canvasHeight === undefined ? null : Number(request.canvasHeight);
    const frozenPromptContext = {
      directTermPromptLocale: text(request.termPromptLocale) === 'zh' ? 'zh' : 'en',
      directTerms: objectArray(request.directTerms).map((term) => ({
        termId: text(term.stableId),
        termRevisionId: text(term.revisionId),
      })),
      recipes: objectArray(request.recipes).map((recipe) => ({
        useId: text(recipe.useId),
        paletteId: text(recipe.stableId),
        paletteRevisionId: text(recipe.revisionId),
        promptLocale: text(recipe.promptLocale),
        parameterValues:
          recipe.parameterValues && typeof recipe.parameterValues === 'object' && !Array.isArray(recipe.parameterValues)
            ? recipe.parameterValues
            : {},
        terms: objectArray(recipe.internalTerms).map((term) => ({
          termId: text(term.stableId),
          termRevisionId: text(term.revisionId),
        })),
        parameters: objectArray(recipe.parameters).flatMap((parameter) =>
          parameter.selectedOptionId
            ? [
                {
                  parameterRevisionId: text(parameter.revisionId) || text(parameter.stableId),
                  optionId: text(parameter.selectedOptionId),
                  valueKey: text(parameter.selectedValue),
                },
              ]
            : [],
        ),
        references: objectArray(recipe.referenceAssets).map((asset) => ({ assetId: text(asset.assetId) })),
      })),
      directReferences: frozenReferences.map((assetId) => ({ assetId })),
    };

    for (const [index, slot] of input.slots.entries()) {
      if (
        !sameStrings(slot.input.termIds, frozenTermIds) ||
        !sameStrings(slot.input.referenceAssetIds, frozenReferences) ||
        canonicalJson(slot.input.wordPaletteReferences) !== canonicalJson(frozenRecipes) ||
        slot.input.canvasPresetKey !== frozenCanvasPresetKey ||
        slot.input.width !== frozenCanvasWidth ||
        slot.input.height !== frozenCanvasHeight
      ) {
        throw new Error('Direction experiment context changed after the assistant proposal was frozen');
      }
      if (
        slot.input.resolvedPrompt &&
        slot.input.resolvedPrompt.userInstruction.trim() !== slot.userInstruction.trim()
      ) {
        throw new Error('Direction prompt does not match its structured prompt snapshot');
      }
      const snapshot = promptSnapshots[index];
      const currentPromptContext = {
        directTermPromptLocale: snapshot.directTermPromptLocale,
        directTerms: snapshot.directTerms.map((term) => ({
          termId: term.termId,
          termRevisionId: term.termRevisionId,
        })),
        recipes: snapshot.recipes.map((recipe) => ({
          useId: recipe.useId,
          paletteId: recipe.paletteId,
          paletteRevisionId: recipe.paletteRevisionId,
          promptLocale: recipe.promptLocale,
          parameterValues: recipe.parameterValues,
          terms: recipe.terms.map((term) => ({
            termId: term.termId,
            termRevisionId: term.termRevisionId,
          })),
          parameters: recipe.parameters.map((parameter) => ({
            parameterRevisionId: parameter.parameterRevisionId,
            optionId: parameter.optionId,
            valueKey: parameter.valueKey,
          })),
          references: recipe.references.map((reference) => ({ assetId: reference.assetId })),
        })),
        directReferences: snapshot.directReferences.map((reference) => ({ assetId: reference.assetId })),
      };
      if (canonicalJson(currentPromptContext) !== canonicalJson(frozenPromptContext)) {
        throw new Error('Term, recipe, or pack revisions changed after the assistant proposal was frozen');
      }
    }
  }

  createFromPreparedRuns(input: CreateStyleExplorationFromRunsInput): StyleExplorationBatchDto {
    return this.db.transaction(() => {
      if (!input.slots.length) throw new Error('Style exploration requires at least one direction');
      this.assertScopeTarget(input.scope);
      this.assertAssistantRun(input.sourceAssistantRunId, input.scope);

      const seenRunIds = new Set<string>();
      for (const slot of input.slots) {
        if (!slot.label.trim()) throw new Error('Style exploration direction label is empty');
        if (!slot.runIds.length) throw new Error('Style exploration direction requires at least one run');
        this.assertVersion(slot.seriesId, slot.versionId);
        for (const runId of slot.runIds) {
          if (seenRunIds.has(runId)) throw new Error('Generation run belongs to more than one exploration direction');
          seenRunIds.add(runId);
          this.assertRunVersion(runId, slot.versionId);
          this.assertRunIsUnlinked(runId);
        }
      }

      const batchId = ulid();
      const timestamp = now();
      const commonConstraints = normalizedConstraints(input.commonConstraints);
      this.db
        .prepare(
          `INSERT INTO style_exploration_batches
        (id, scope_kind, scope_id, source_assistant_run_id, common_constraints_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          batchId,
          input.scope.kind,
          input.scope.id,
          input.sourceAssistantRunId,
          JSON.stringify(commonConstraints),
          timestamp,
          timestamp,
        );

      input.slots.forEach((slot, slotOrder) => {
        const slotId = ulid();
        this.db
          .prepare(
            `INSERT INTO style_exploration_slots
          (id, batch_id, sort_order, label, rationale, variable_axis, risk, user_instruction,
           series_id, prompt_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            slotId,
            batchId,
            slotOrder,
            slot.label.trim(),
            slot.rationale.trim(),
            slot.variableAxis.trim(),
            slot.risk.trim(),
            slot.userInstruction.trim(),
            slot.seriesId,
            slot.versionId,
          );
        slot.runIds.forEach((runId, runOrder) => {
          this.db
            .prepare(
              `INSERT INTO style_exploration_slot_runs
            (id, slot_id, generation_run_id, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)`,
            )
            .run(ulid(), slotId, runId, runOrder, timestamp);
        });
        this.storage.recordChange('STYLE_EXPLORATION_SLOT', slotId, 'CREATE', {
          batchId,
          sortOrder: slotOrder,
          seriesId: slot.seriesId,
          versionId: slot.versionId,
          runIds: slot.runIds,
        });
      });
      this.storage.recordChange('STYLE_EXPLORATION_BATCH', batchId, 'CREATE', {
        scope: input.scope,
        sourceAssistantRunId: input.sourceAssistantRunId,
        commonConstraints,
      });
      if (input.delegation) {
        this.directorTasks.create({
          scope: input.scope,
          sourceAssistantRunId: input.sourceAssistantRunId,
          batchId,
          fixedConstraints: commonConstraints,
          directionCount: input.slots.length,
          targets: input.targets ?? [],
          delegation: input.delegation,
        });
      }
      const proposal = this.db
        .prepare(
          `SELECT proposal.id, proposal.status, run.context_key
        FROM assistant_proposals proposal
        JOIN assistant_runs run ON run.id = proposal.assistant_run_id
        WHERE proposal.assistant_run_id = ?`,
        )
        .get(input.sourceAssistantRunId) as JsonMap | undefined;
      if (proposal && text(proposal.status) === 'READY') {
        this.db
          .prepare(
            `UPDATE assistant_proposals
          SET status = 'ADOPTED', adopted_context_key = ?, updated_at = ?
          WHERE id = ? AND status = 'READY'`,
          )
          .run(text(proposal.context_key), timestamp, proposal.id);
        this.storage.recordChange('ASSISTANT_PROPOSAL', text(proposal.id), 'ADOPTED', {
          assistantRunId: input.sourceAssistantRunId,
          styleExplorationBatchId: batchId,
        });
      }
      return this.require(batchId);
    })();
  }

  linkRetryRun(slotId: string, runId: string): StyleExplorationSlotDto {
    return this.db.transaction(() => {
      const slot = this.db
        .prepare(
          `SELECT slot.*, batch.updated_at
        FROM style_exploration_slots slot
        JOIN style_exploration_batches batch ON batch.id = slot.batch_id
        WHERE slot.id = ?`,
        )
        .get(slotId) as JsonMap | undefined;
      if (!slot) throw new Error('Style exploration direction not found');
      this.assertRunVersion(runId, text(slot.prompt_version_id));
      this.assertRunIsUnlinked(runId);

      const retrySource = this.db
        .prepare(
          `SELECT source_link.generation_run_id AS source_run_id
        FROM generation_job_links retry_link
        JOIN background_jobs retry_job ON retry_job.id = retry_link.job_id
        JOIN generation_job_links source_link ON source_link.job_id = retry_job.retry_of_job_id
        WHERE retry_link.generation_run_id = ?`,
        )
        .get(runId) as JsonMap | undefined;
      if (
        !retrySource ||
        !this.db
          .prepare(
            `SELECT 1 FROM style_exploration_slot_runs
        WHERE slot_id = ? AND generation_run_id = ?`,
          )
          .get(slotId, retrySource.source_run_id)
      ) {
        throw new Error('Generation run is not a retry of this exploration direction');
      }

      const nextOrder = Number(
        (
          this.db
            .prepare(
              `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
        FROM style_exploration_slot_runs WHERE slot_id = ?`,
            )
            .get(slotId) as JsonMap
        ).next_order,
      );
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO style_exploration_slot_runs
        (id, slot_id, generation_run_id, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?)`,
        )
        .run(ulid(), slotId, runId, nextOrder, timestamp);
      this.db.prepare('UPDATE style_exploration_batches SET updated_at = ? WHERE id = ?').run(timestamp, slot.batch_id);
      this.storage.recordChange('STYLE_EXPLORATION_SLOT', slotId, 'LINK_RETRY', {
        runId,
        sourceRunId: text(retrySource.source_run_id),
        sortOrder: nextOrder,
      });
      return this.requireSlot(slotId);
    })();
  }

  get(batchId: string): StyleExplorationBatchDto | null {
    const row = this.db.prepare('SELECT * FROM style_exploration_batches WHERE id = ?').get(batchId) as
      JsonMap | undefined;
    return row ? this.batchDto(row) : null;
  }

  list(scope: CreatorAgentScope): StyleExplorationBatchDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM style_exploration_batches
      WHERE scope_kind = ? AND scope_id = ?
      ORDER BY created_at DESC, id DESC`,
      )
      .all(scope.kind, scope.id) as JsonMap[];
    return rows.map((row) => this.batchDto(row));
  }

  listAll(limit = 50): StyleExplorationBatchDto[] {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM style_exploration_batches
      ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(safeLimit) as JsonMap[];
    return rows.map((row) => this.batchDto(row));
  }

  getSlot(slotId: string): StyleExplorationSlotDto | null {
    const row = this.db.prepare('SELECT * FROM style_exploration_slots WHERE id = ?').get(slotId) as
      JsonMap | undefined;
    return row ? this.slotDto(row) : null;
  }

  runIdsForBatch(batchId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT link.generation_run_id
      FROM style_exploration_slots slot
      JOIN style_exploration_slot_runs link ON link.slot_id = slot.id
      WHERE slot.batch_id = ?
      ORDER BY slot.sort_order, slot.id, link.sort_order, link.id`,
        )
        .all(batchId) as JsonMap[]
    ).map((row) => text(row.generation_run_id));
  }

  runIdsForSlot(slotId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT generation_run_id FROM style_exploration_slot_runs
      WHERE slot_id = ? ORDER BY sort_order, id`,
        )
        .all(slotId) as JsonMap[]
    ).map((row) => text(row.generation_run_id));
  }

  slotIdForRun(runId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT slot_id FROM style_exploration_slot_runs
      WHERE generation_run_id = ?`,
      )
      .get(runId) as JsonMap | undefined;
    return row ? text(row.slot_id) : null;
  }

  retryableRunIdsForSlot(slotId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT link.generation_run_id
      FROM style_exploration_slot_runs link
      JOIN generation_runs run ON run.id = link.generation_run_id
      JOIN generation_job_links source_link ON source_link.generation_run_id = run.id
      WHERE link.slot_id = ?
        AND run.status IN ('FAILED', 'CANCELLED', 'INTERRUPTED')
        AND NOT EXISTS (
          SELECT 1 FROM background_jobs retry_job
          JOIN generation_job_links retry_run_link ON retry_run_link.job_id = retry_job.id
          JOIN style_exploration_slot_runs retry_slot_link
            ON retry_slot_link.generation_run_id = retry_run_link.generation_run_id
          WHERE retry_job.retry_of_job_id = source_link.job_id
            AND retry_slot_link.slot_id = link.slot_id
        )
      ORDER BY link.sort_order, link.id`,
        )
        .all(slotId) as JsonMap[]
    ).map((row) => text(row.generation_run_id));
  }

  private require(batchId: string): StyleExplorationBatchDto {
    const batch = this.get(batchId);
    if (!batch) throw new Error('Style exploration not found');
    return batch;
  }

  private requireSlot(slotId: string): StyleExplorationSlotDto {
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error('Style exploration direction not found');
    return slot;
  }

  private batchDto(row: JsonMap): StyleExplorationBatchDto {
    const batchId = text(row.id);
    const slotRows = this.db
      .prepare(
        `SELECT * FROM style_exploration_slots
      WHERE batch_id = ? ORDER BY sort_order, id`,
      )
      .all(batchId) as JsonMap[];
    const slots = slotRows.map((slot) => this.slotDto(slot));
    const runs = slotRows.flatMap((slot) => this.currentAttemptRuns(text(slot.id)));
    const projection = statusProjection(runs);
    return {
      id: batchId,
      scope: {
        kind: text(row.scope_kind) as CreatorAgentScope['kind'],
        id: text(row.scope_id),
      },
      sourceAssistantRunId: text(row.source_assistant_run_id),
      commonConstraints: strings(this.parseJson(row.common_constraints_json)),
      ...projection,
      slots,
      directorTask: this.directorTasks.getForBatch(batchId),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  }

  private slotDto(row: JsonMap): StyleExplorationSlotDto {
    const slotId = text(row.id);
    const runRows = this.db
      .prepare(
        `SELECT run.id, run.status
      FROM style_exploration_slot_runs link
      JOIN generation_runs run ON run.id = link.generation_run_id
      WHERE link.slot_id = ? ORDER BY link.sort_order, link.id`,
      )
      .all(slotId) as JsonMap[];
    const runs = runRows.map((run) => ({ id: text(run.id), status: text(run.status) }));
    const currentAttempts = this.currentAttemptRuns(slotId);
    return {
      id: slotId,
      batchId: text(row.batch_id),
      sortOrder: Number(row.sort_order),
      label: text(row.label),
      rationale: text(row.rationale),
      variableAxis: text(row.variable_axis),
      risk: text(row.risk),
      userInstruction: text(row.user_instruction),
      seriesId: text(row.series_id),
      versionId: text(row.prompt_version_id),
      runIds: runs.map((run) => run.id),
      ...statusProjection(currentAttempts),
    };
  }

  /** Project logical generation positions from lineage leaves, while runIds
   * still retain every historical attempt for audit and asset provenance. */
  private currentAttemptRuns(slotId: string): RunProjection[] {
    const rows = this.db
      .prepare(
        `SELECT run.id, run.status
      FROM style_exploration_slot_runs link
      JOIN generation_runs run ON run.id = link.generation_run_id
      LEFT JOIN generation_job_links source_job_link
        ON source_job_link.generation_run_id = run.id
      WHERE link.slot_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM background_jobs retry_job
          JOIN generation_job_links retry_run_link ON retry_run_link.job_id = retry_job.id
          JOIN style_exploration_slot_runs retry_slot_link
            ON retry_slot_link.generation_run_id = retry_run_link.generation_run_id
          WHERE retry_job.retry_of_job_id = source_job_link.job_id
            AND retry_slot_link.slot_id = link.slot_id
        )
      ORDER BY link.sort_order, link.id`,
      )
      .all(slotId) as JsonMap[];
    return rows.map((row) => ({ id: text(row.id), status: text(row.status) }));
  }

  private assertScopeTarget(scope: CreatorAgentScope) {
    const target =
      scope.kind === 'DRAFT'
        ? this.db
            .prepare(
              `SELECT 1 FROM creation_drafts
        WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
            )
            .get(scope.id)
        : this.db.prepare('SELECT 1 FROM prompt_series WHERE id = ? AND deleted_at IS NULL').get(scope.id);
    if (!target) throw new Error('Style exploration target is no longer available');
  }

  private assertAssistantRun(runId: string, scope: CreatorAgentScope) {
    const run = this.db
      .prepare(
        `SELECT run.scope_kind, run.scope_id, run.status,
        proposal.status AS proposal_status
      FROM assistant_runs run
      LEFT JOIN assistant_proposals proposal ON proposal.assistant_run_id = run.id
      WHERE run.id = ?`,
      )
      .get(runId) as JsonMap | undefined;
    if (!run) throw new Error('Assistant run not found');
    if (text(run.scope_kind) !== scope.kind || text(run.scope_id) !== scope.id) {
      throw new Error('Assistant run belongs to a different creation scope');
    }
    if (text(run.status) !== 'SUCCEEDED') throw new Error('Assistant run has no completed direction proposal');
    if (!['READY', 'ADOPTED'].includes(text(run.proposal_status))) {
      throw new Error('Assistant proposal is no longer available for an experiment');
    }
  }

  private assertVersion(seriesId: string, versionId: string) {
    if (
      !this.db
        .prepare(
          `SELECT 1 FROM prompt_versions version
      JOIN prompt_series series ON series.id = version.series_id
      WHERE version.id = ? AND version.series_id = ? AND series.deleted_at IS NULL`,
        )
        .get(versionId, seriesId)
    ) {
      throw new Error('Style exploration prompt version does not belong to its series');
    }
  }

  private assertRunVersion(runId: string, versionId: string) {
    const run = this.db.prepare('SELECT prompt_version_id FROM generation_runs WHERE id = ?').get(runId) as
      JsonMap | undefined;
    if (!run) throw new Error('Generation run not found');
    if (text(run.prompt_version_id) !== versionId) {
      throw new Error('Generation run does not use the exploration direction prompt version');
    }
  }

  private assertRunIsUnlinked(runId: string) {
    if (
      this.db
        .prepare(
          `SELECT 1 FROM style_exploration_slot_runs
      WHERE generation_run_id = ?`,
        )
        .get(runId)
    ) {
      throw new Error('Generation run already belongs to a style exploration');
    }
  }

  private parseJson(value: unknown): unknown {
    try {
      return JSON.parse(text(value));
    } catch {
      return [];
    }
  }

  private parseObject(value: unknown): JsonMap {
    const parsed = this.parseJson(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  }
}
