import { ulid } from 'ulid';
import type {
  AssistantCapabilityReceiptDto,
  AssistantProposalAdoptionInput,
  AssistantProposalStatus,
  AssistantReasoningEffort,
  AssistantRunDto,
  CodexAssistResult,
  CreatorAgentAssistInput,
  CreatorAgentScope,
  PromptDraftNodeDto,
} from '@/shared/contracts';
import { CODEX_ASSISTANT_DEFAULT_MODEL_KEY, CODEX_ASSISTANT_DEFAULT_REASONING_EFFORT } from '@/shared/extension-ids';
import type { LibraryStorage } from '@/main/database/core/storage';
import { CreationRepository } from '@/main/database/creations/creation-repository';
import { type JsonMap, now, strings, text } from '@/main/database/core/values';

type AssistantMode = AssistantRunDto['mode'];

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'INTERRUPTED']);
const RUN_WITH_PROPOSAL_SQL = `SELECT run.*,
  (SELECT COUNT(*) FROM assistant_runs occurrence
    WHERE occurrence.scope_kind = run.scope_kind
      AND occurrence.scope_id = run.scope_id
      AND occurrence.mode = run.mode
      AND (occurrence.created_at < run.created_at
        OR (occurrence.created_at = run.created_at AND occurrence.id <= run.id))) AS occurrence_no,
  (SELECT COUNT(*) FROM assistant_runs occurrence
    WHERE occurrence.scope_kind = run.scope_kind
      AND occurrence.scope_id = run.scope_id
      AND occurrence.mode = run.mode) AS occurrence_count,
  proposal.id AS proposal_id,
  proposal.status AS proposal_status,
  proposal.result_json AS proposal_result_json,
  proposal.adopted_context_key AS proposal_adopted_context_key,
  proposal.created_at AS proposal_created_at,
  proposal.updated_at AS proposal_updated_at
FROM assistant_runs run
LEFT JOIN assistant_proposals proposal ON proposal.assistant_run_id = run.id`;

function parseObject(value: unknown): JsonMap {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

function parseCapabilityReceipt(value: unknown): AssistantCapabilityReceiptDto {
  const receipt = parseObject(value);
  return {
    directTermCount: Number(receipt.directTermCount) || 0,
    ...(receipt.candidateTermCount === undefined
      ? {}
      : { candidateTermCount: Number(receipt.candidateTermCount) || 0 }),
    recipeCount: Number(receipt.recipeCount) || 0,
    referenceCount: Number(receipt.referenceCount) || 0,
    visionAnalyzed: false,
  };
}

function parseResult(value: unknown): CodexAssistResult | null {
  if (value === null || value === undefined || value === '') return null;
  const result = parseObject(value);
  const hasPromptEdit = Boolean(
    result.promptEdit && typeof result.promptEdit === 'object' && !Array.isArray(result.promptEdit),
  );
  const promptEdit =
    result.promptEdit && typeof result.promptEdit === 'object' && !Array.isArray(result.promptEdit)
      ? (result.promptEdit as JsonMap)
      : {};
  const changes = Array.isArray(promptEdit.changes) ? promptEdit.changes : [];
  const assumptions = Array.isArray(result.assumptions) ? result.assumptions : [];
  const directions = Array.isArray(result.directions) ? result.directions : [];
  const rawPromptDraft =
    result.promptDraft && typeof result.promptDraft === 'object' && !Array.isArray(result.promptDraft)
      ? (result.promptDraft as JsonMap)
      : null;
  const promptDraftNodes = Array.isArray(rawPromptDraft?.contentNodes) ? rawPromptDraft.contentNodes : [];
  const promptDraft = rawPromptDraft
    ? {
        summary: text(rawPromptDraft.summary),
        warnings: strings(rawPromptDraft.warnings),
        contentNodes: promptDraftNodes.flatMap<PromptDraftNodeDto>((rawNode) => {
          if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) return [];
          const node = rawNode as JsonMap;
          if (node.kind === 'TEXT') return [{ kind: 'TEXT' as const, text: text(node.text) }];
          if (node.kind === 'TERM') {
            return [
              {
                kind: 'TERM' as const,
                termId: text(node.termId),
                termRevisionId: text(node.termRevisionId),
                displayName: text(node.displayName),
              },
            ];
          }
          if (node.kind === 'RECIPE') {
            const values =
              node.parameterValues && typeof node.parameterValues === 'object' && !Array.isArray(node.parameterValues)
                ? Object.fromEntries(
                    Object.entries(node.parameterValues as JsonMap).map(([key, entry]) => [key, text(entry)]),
                  )
                : {};
            const promptLocale = node.promptLocale === 'zh' ? 'zh' : 'en';
            return [
              {
                kind: 'RECIPE' as const,
                paletteId: text(node.paletteId),
                paletteRevisionId: text(node.paletteRevisionId),
                displayName: text(node.displayName),
                parameterValues: values,
                promptLocale,
              },
            ];
          }
          return [];
        }),
      }
    : undefined;
  return {
    assistantMessage: text(result.assistantMessage),
    ...(typeof result.optimizedPrompt === 'string' ? { optimizedPrompt: text(result.optimizedPrompt) } : {}),
    ...(hasPromptEdit
      ? {
          promptEdit: {
            summary: text(promptEdit.summary),
            preserved: strings(promptEdit.preserved),
            changes: changes.flatMap((change) => {
              if (!change || typeof change !== 'object' || Array.isArray(change)) return [];
              const item = change as JsonMap;
              return [
                {
                  before: text(item.before),
                  after: text(item.after),
                  reason: text(item.reason),
                },
              ];
            }),
            removed: strings(promptEdit.removed),
            revisedUserInstruction: text(promptEdit.revisedUserInstruction),
          },
        }
      : {}),
    ...(promptDraft ? { promptDraft } : {}),
    sharedConstraints: strings(result.sharedConstraints),
    assumptions: assumptions.flatMap((assumption) => {
      if (!assumption || typeof assumption !== 'object' || Array.isArray(assumption)) return [];
      const item = assumption as JsonMap;
      return [
        {
          label: text(item.label),
          interpretation: text(item.interpretation),
          impact: text(item.impact),
        },
      ];
    }),
    directions: directions.flatMap((direction) => {
      if (!direction || typeof direction !== 'object' || Array.isArray(direction)) return [];
      const item = direction as JsonMap;
      return [
        {
          label: text(item.label),
          prompt: text(item.prompt),
          rationale: text(item.rationale),
          variableAxis: text(item.variableAxis),
          risk: text(item.risk),
        },
      ];
    }),
  };
}

function toRun(row: JsonMap): AssistantRunDto {
  const persistedInput = parseObject(row.request_json) as unknown as CreatorAgentAssistInput;
  const scope = {
    kind: text(row.scope_kind) as CreatorAgentScope['kind'],
    id: text(row.scope_id),
  };
  const mode = text(row.mode) as AssistantMode;
  const contextKey = text(row.context_key);
  const proposalResult = parseResult(row.proposal_result_json);
  return {
    id: text(row.id),
    scope,
    mode,
    occurrenceNo: Math.max(1, Number(row.occurrence_no) || 1),
    occurrenceCount: Math.max(1, Number(row.occurrence_count) || 1),
    status: text(row.status) as AssistantRunDto['status'],
    providerKey: text(row.provider_key) || 'codex',
    modelKey: text(row.model_key) || 'codex',
    reasoningEffort:
      row.reasoning_effort === null || row.reasoning_effort === undefined
        ? null
        : (text(row.reasoning_effort) as AssistantReasoningEffort),
    contextKey,
    contextHash: text(row.context_hash),
    input: {
      ...persistedInput,
      scope,
      mode,
      contextKey,
      canvasWidth: typeof persistedInput.canvasWidth === 'number' ? persistedInput.canvasWidth : null,
      canvasHeight: typeof persistedInput.canvasHeight === 'number' ? persistedInput.canvasHeight : null,
    },
    capabilityReceipt: parseCapabilityReceipt(row.capability_receipt_json),
    proposal:
      row.proposal_id && proposalResult
        ? {
            id: text(row.proposal_id),
            assistantRunId: text(row.id),
            status: text(row.proposal_status) as AssistantProposalStatus,
            adoptedContextKey:
              row.proposal_adopted_context_key === null || row.proposal_adopted_context_key === undefined
                ? null
                : text(row.proposal_adopted_context_key),
            result: proposalResult,
            createdAt: text(row.proposal_created_at),
            updatedAt: text(row.proposal_updated_at),
          }
        : null,
    errorMessage: text(row.error_message),
    dismissedAt: row.dismissed_at === null || row.dismissed_at === undefined ? null : text(row.dismissed_at),
    createdAt: text(row.created_at),
    finishedAt: row.finished_at === null ? null : text(row.finished_at),
  };
}

export class AssistantRunRepository {
  private readonly db: LibraryStorage['db'];

  constructor(
    private readonly storage: LibraryStorage,
    private readonly creations = new CreationRepository(storage),
  ) {
    this.db = storage.db;
  }

  interruptRunningAtStartup(): number {
    return this.db.transaction(() => {
      const running = this.db.prepare("SELECT id FROM assistant_runs WHERE status = 'RUNNING'").all() as JsonMap[];
      const interruptedAt = now();
      for (const row of running) {
        const id = text(row.id);
        this.db
          .prepare(
            `UPDATE assistant_runs
          SET status = 'INTERRUPTED', error_message = ?, updated_at = ?, finished_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
          )
          .run('Application closed before assistant response completed', interruptedAt, interruptedAt, id);
        this.storage.recordChange('ASSISTANT_RUN', id, 'INTERRUPT', {
          errorCode: 'APPLICATION_CLOSED',
        });
      }
      return running.length;
    })();
  }

  start(
    input: CreatorAgentAssistInput,
    contextHash: string,
    capabilityReceipt: AssistantCapabilityReceiptDto,
    execution?: { providerKey: string; modelKey: string; reasoningEffort?: AssistantReasoningEffort | null },
  ): AssistantRunDto {
    if (input.mode !== 'optimize' && input.mode !== 'directions') {
      throw new Error(`Unsupported persisted assistant mode: ${input.mode}`);
    }
    if (!input.contextKey.trim()) throw new Error('Assistant context key is required');
    if (!contextHash.trim()) throw new Error('Assistant context hash is required');

    const effectiveExecution = execution ?? {
      providerKey: 'codex',
      modelKey: CODEX_ASSISTANT_DEFAULT_MODEL_KEY,
      reasoningEffort: CODEX_ASSISTANT_DEFAULT_REASONING_EFFORT,
    };
    return this.db.transaction(() => {
      this.requireAvailableScope(input.scope);
      if (input.parentProposalId) this.requireParentProposal(input.parentProposalId, input.scope);
      const id = ulid();
      const startedAt = now();
      this.db
        .prepare(
          `INSERT INTO assistant_runs
        (id, scope_kind, scope_id, mode, status, request_json, context_key, context_hash,
          capability_receipt_json, error_message, provider_key, model_key, reasoning_effort,
          created_at, started_at, updated_at, finished_at)
        VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          input.scope.kind,
          input.scope.id,
          input.mode,
          JSON.stringify(input),
          input.contextKey,
          contextHash,
          JSON.stringify(capabilityReceipt),
          effectiveExecution.providerKey,
          effectiveExecution.modelKey,
          effectiveExecution.reasoningEffort ?? null,
          startedAt,
          startedAt,
          startedAt,
        );
      this.storage.recordChange('ASSISTANT_RUN', id, 'CREATE', {
        scope: input.scope,
        mode: input.mode,
        contextKey: input.contextKey,
        contextHash,
      });
      return this.get(id)!;
    })();
  }

  succeed(id: string, result: CodexAssistResult): AssistantRunDto {
    return this.finish(id, 'SUCCEEDED', result, null);
  }

  fail(id: string, errorMessage: string): AssistantRunDto {
    return this.finish(id, 'FAILED', null, errorMessage);
  }

  interrupt(id: string, errorMessage: string): AssistantRunDto {
    return this.finish(id, 'INTERRUPTED', null, errorMessage);
  }

  expireProposal(runId: string, currentContextKey: string): AssistantRunDto {
    const run = this.get(runId);
    if (!run) throw new Error(`Assistant run not found: ${runId}`);
    if (
      !currentContextKey.trim() ||
      currentContextKey === run.contextKey ||
      currentContextKey === run.proposal?.adoptedContextKey
    ) {
      throw new Error('Assistant proposal still matches the current creation input');
    }
    return this.setProposalStatus(runId, 'EXPIRED', null, null, {
      changeDetails: {
        reason: 'CONTEXT_CHANGED',
        currentContextKey,
        baseContextKey: run.contextKey,
        adoptedContextKey: run.proposal?.adoptedContextKey ?? null,
      },
    });
  }

  revalidateProposal(runId: string, currentContextKey: string): AssistantRunDto {
    const run = this.get(runId);
    if (!run?.proposal) throw new Error('Assistant proposal not found');
    if (!currentContextKey.trim()) throw new Error('Assistant proposal context is required');
    const restoredStatus = run.proposal.adoptedContextKey
      ? currentContextKey === run.proposal.adoptedContextKey
        ? 'ADOPTED'
        : null
      : currentContextKey === run.contextKey
        ? 'READY'
        : null;
    if (!restoredStatus) throw new Error('Assistant proposal does not match the current creation input');
    if (run.proposal.status === restoredStatus) return run;
    if (run.proposal.status !== 'EXPIRED') {
      throw new Error(`Assistant proposal is already ${run.proposal.status.toLowerCase()}`);
    }
    return this.setProposalStatus(
      runId,
      restoredStatus,
      restoredStatus === 'ADOPTED' ? currentContextKey : null,
      null,
      {
        allowExpiredReady: true,
        changeDetails: {
          reason: 'CONTEXT_REVALIDATED',
          currentContextKey,
          baseContextKey: run.contextKey,
          adoptedContextKey: run.proposal.adoptedContextKey,
        },
      },
    );
  }

  adoptProposal(input: AssistantProposalAdoptionInput): AssistantRunDto {
    if (!input.authorizedContextKey.trim() || !input.resultContextKey.trim() || !input.baseContextKey.trim()) {
      throw new Error('Assistant proposal revision context is required');
    }
    if (!input.afterPrompt.trim()) throw new Error('An adopted assistant prompt cannot be empty');
    const run = this.get(input.runId);
    if (!run?.proposal) throw new Error('Assistant proposal not found');
    if (run.contextKey !== input.baseContextKey && run.proposal.adoptedContextKey !== input.baseContextKey) {
      throw new Error('Assistant proposal does not match the current creation input');
    }
    return this.setProposalStatus(input.runId, 'ADOPTED', input.authorizedContextKey, input);
  }

  closeProposal(runId: string): AssistantRunDto {
    return this.setProposalStatus(runId, 'CLOSED');
  }

  dismiss(runId: string): AssistantRunDto {
    return this.db.transaction(() => {
      const run = this.get(runId);
      if (!run) throw new Error(`Assistant run not found: ${runId}`);
      if (run.status === 'RUNNING') throw new Error('A running assistant request cannot be dismissed');
      if (run.dismissedAt) return run;
      const dismissedAt = now();
      const update = this.db
        .prepare(
          `UPDATE assistant_runs
        SET dismissed_at = ?, updated_at = ? WHERE id = ? AND dismissed_at IS NULL`,
        )
        .run(dismissedAt, dismissedAt, runId);
      if (update.changes !== 1) throw new Error('Assistant run state changed before dismissal');
      this.storage.recordChange('ASSISTANT_RUN', runId, 'DISMISS', { dismissedAt });
      return this.get(runId)!;
    })();
  }

  get(id: string): AssistantRunDto | null {
    const row = this.db.prepare(`${RUN_WITH_PROPOSAL_SQL} WHERE run.id = ?`).get(id) as JsonMap | undefined;
    return row ? this.hydrateMany([toRun(row)])[0] : null;
  }

  list(scope: CreatorAgentScope): AssistantRunDto[] {
    const rows = this.db
      .prepare(
        `${RUN_WITH_PROPOSAL_SQL}
      WHERE run.scope_kind = ? AND run.scope_id = ?
      ORDER BY run.created_at DESC, run.id DESC`,
      )
      .all(scope.kind, scope.id) as JsonMap[];
    return this.hydrateMany(rows.map(toRun));
  }

  listRecent(limit = 50): AssistantRunDto[] {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `${RUN_WITH_PROPOSAL_SQL}
      ORDER BY run.created_at DESC, run.id DESC LIMIT ?`,
      )
      .all(safeLimit) as JsonMap[];
    return this.hydrateMany(rows.map(toRun));
  }

  private hydrateMany(runs: AssistantRunDto[]): AssistantRunDto[] {
    const creations = this.creations.hydrateAssistantRuns(runs.map((run) => run.id));
    return runs.map((run) => {
      const creation = creations.get(run.id);
      return {
        ...run,
        creationId: creation?.creationId ?? null,
        creationTitle: creation?.creationTitle ?? null,
        activityEvents: creation?.activityEvents ?? [],
      };
    });
  }

  private finish(
    id: string,
    status: 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED',
    result: CodexAssistResult | null,
    errorMessage: string | null,
  ): AssistantRunDto {
    return this.db.transaction(() => {
      const existing = this.get(id);
      if (!existing) throw new Error(`Assistant run not found: ${id}`);
      if (TERMINAL_STATUSES.has(existing.status)) {
        throw new Error(`Assistant run is already ${existing.status.toLowerCase()}`);
      }
      const finishedAt = now();
      const update = this.db
        .prepare(
          `UPDATE assistant_runs
        SET status = ?, error_message = ?, updated_at = ?, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(status, errorMessage, finishedAt, finishedAt, id);
      if (update.changes !== 1) throw new Error('Assistant run state changed before completion');
      if (status === 'SUCCEEDED' && result) {
        this.db
          .prepare(
            `INSERT INTO assistant_proposals
          (id, assistant_run_id, status, result_json, created_at, updated_at)
          VALUES (?, ?, 'READY', ?, ?, ?)`,
          )
          .run(id, id, JSON.stringify(result), finishedAt, finishedAt);
      }
      const operation = status === 'SUCCEEDED' ? 'SUCCEED' : status === 'INTERRUPTED' ? 'INTERRUPT' : 'FAIL';
      this.storage.recordChange('ASSISTANT_RUN', id, operation, {
        status,
        errorMessage,
      });
      return this.get(id)!;
    })();
  }

  private setProposalStatus(
    runId: string,
    status: AssistantProposalStatus,
    adoptedContextKey: string | null = null,
    application: AssistantProposalAdoptionInput | null = null,
    options: {
      allowExpiredReady?: boolean;
      changeDetails?: Record<string, unknown>;
    } = {},
  ): AssistantRunDto {
    return this.db.transaction(() => {
      const run = this.get(runId);
      if (!run?.proposal) throw new Error('Assistant proposal not found');
      const current = run.proposal.status;
      if (
        current === status &&
        (status !== 'ADOPTED' || run.proposal.adoptedContextKey === adoptedContextKey) &&
        !application
      )
        return run;
      if (
        current === 'CLOSED' ||
        (current === 'ADOPTED' && !['ADOPTED', 'EXPIRED', 'CLOSED'].includes(status)) ||
        (current === 'EXPIRED' && status === 'READY' && !options.allowExpiredReady)
      ) {
        throw new Error(`Assistant proposal is already ${current.toLowerCase()}`);
      }
      const updatedAt = now();
      const update = this.db
        .prepare(
          `UPDATE assistant_proposals
        SET status = ?, adopted_context_key = COALESCE(?, adopted_context_key), updated_at = ?
        WHERE assistant_run_id = ? AND status = ?`,
        )
        .run(status, status === 'ADOPTED' ? adoptedContextKey : null, updatedAt, runId, current);
      if (update.changes !== 1) throw new Error('Assistant proposal state changed before update');
      if (application) {
        this.recordProposalApplication(run, application);
      }
      this.storage.recordChange('ASSISTANT_PROPOSAL', run.proposal.id, status, {
        assistantRunId: runId,
        previousStatus: current,
        status,
        adoptedContextKey: status === 'ADOPTED' ? adoptedContextKey : null,
        ...options.changeDetails,
      });
      return this.get(runId)!;
    })();
  }

  private recordProposalApplication(run: AssistantRunDto, application: AssistantProposalAdoptionInput) {
    if (!run.proposal) throw new Error('Assistant proposal not found');
    this.storage.recordChange('ASSISTANT_PROPOSAL_APPLICATION', ulid(), 'CREATE', {
      assistantProposalId: run.proposal.id,
      assistantRunId: run.id,
      scope: run.scope,
      baseContextKey: application.baseContextKey,
      resultContextKey: application.resultContextKey,
      authorizedContextKey: application.authorizedContextKey,
      beforePrompt: application.beforePrompt,
      afterPrompt: application.afterPrompt,
      beforeDocument: application.beforeDocument ?? null,
      afterDocument: application.afterDocument ?? null,
    });
  }

  private requireAvailableScope(scope: CreatorAgentScope) {
    const target =
      scope.kind === 'DRAFT'
        ? this.db
            .prepare(
              `SELECT id FROM creation_drafts
        WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
            )
            .get(scope.id)
        : this.db.prepare('SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL').get(scope.id);
    if (!target) throw new Error('Assistant target is no longer available');
  }

  private requireParentProposal(proposalId: string, scope: CreatorAgentScope) {
    const proposal = this.db
      .prepare(
        `SELECT run.scope_kind, run.scope_id, proposal.status
      FROM assistant_proposals proposal
      JOIN assistant_runs run ON run.id = proposal.assistant_run_id
      WHERE proposal.id = ?`,
      )
      .get(proposalId) as JsonMap | undefined;
    if (!proposal) throw new Error('Parent assistant proposal not found');
    if (text(proposal.scope_kind) !== scope.kind || text(proposal.scope_id) !== scope.id) {
      throw new Error('Parent assistant proposal belongs to a different creation scope');
    }
    if (text(proposal.status) === 'CLOSED') throw new Error('Parent assistant proposal is closed');
  }
}
