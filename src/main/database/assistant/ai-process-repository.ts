import { ulid } from 'ulid';
import type { CreatorAgentScope } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';

export type AiProcessTransport = 'app-server' | 'exec';

export interface AiProcessUsageHeader {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

/**
 * A bounded semantic header observed by the host application. Provider payloads,
 * message bodies, command text, files, secrets, and hidden reasoning do not cross
 * this storage boundary.
 */
export interface AiProcessObservableEventInput {
  method: string;
  itemId?: string;
  itemType?: string;
  itemStatus?: string;
  toolKind?: string;
  toolName?: string;
  usage?: AiProcessUsageHeader;
  degradationReason?: string;
  droppedEventCount?: number;
  droppedEventCountExact?: boolean;
}

const MAX_OBSERVABLE_EVENT_HEADERS = 2_000;
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;

function bounded(value: unknown, maximum: number) {
  const candidate = text(value).trim();
  return candidate ? candidate.slice(0, maximum) : null;
}

function safeCode(value: unknown, fallback: string) {
  const candidate = text(value).trim().toUpperCase().replaceAll('-', '_');
  return SAFE_CODE.test(candidate) ? candidate : fallback;
}

function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function terminalError(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? safeCode(error.code, 'EXECUTION_FAILED')
      : 'EXECUTION_FAILED';
  const name = error instanceof Error ? error.name : '';
  const cancelled = code === 'CANCELLED' || name === 'AbortError';
  const interrupted = code === 'INTERRUPTED';
  return {
    status: cancelled ? ('CANCELLED' as const) : interrupted ? ('INTERRUPTED' as const) : ('FAILED' as const),
    code: cancelled ? 'CANCELLED' : interrupted ? 'INTERRUPTED' : code,
  };
}

function degradedCompleteness(reason: string) {
  return /(LIMIT|BUDGET|TRUNCATED|POLICY)/.test(reason) ? 'TRUNCATED_BY_POLICY' : 'PARTIAL_CAPTURE';
}

export class AiProcessRepository {
  private readonly db: LibraryStorage['db'];

  constructor(storage: LibraryStorage) {
    this.db = storage.db;
  }

  startAgentChat(scope: CreatorAgentScope, historyTurnIds: readonly string[]) {
    return this.db.transaction(() => {
      const frozenHistoryTurnIds = [...new Set(historyTurnIds)].slice(0, 20);
      const processId = ulid();
      const attemptId = ulid();
      const startedAt = now();
      this.db
        .prepare(
          `INSERT INTO ai_processes
          (id, process_kind, scope_kind, scope_id, status, completeness, started_at)
          VALUES (?, 'AGENT_CHAT', ?, ?, 'RUNNING', 'PARTIAL_CAPTURE', ?)`,
        )
        .run(processId, scope.kind, scope.id, startedAt);
      this.db
        .prepare(
          `INSERT INTO ai_process_attempts
          (id, process_id, attempt_no, provider_key, transport, status, completeness, started_at)
          VALUES (?, ?, 1, 'codex', 'PENDING', 'RUNNING', 'PARTIAL_CAPTURE', ?)`,
        )
        .run(attemptId, processId, startedAt);
      for (const [ordinal, turnId] of frozenHistoryTurnIds.entries()) {
        const source = this.db
          .prepare(
            `SELECT id FROM creator_agent_turns
            WHERE id = ? AND scope_kind = ? AND scope_id = ?`,
          )
          .get(turnId, scope.kind, scope.id);
        if (!source) throw new Error('Agent chat context turn is unavailable');
        this.db
          .prepare(
            `INSERT INTO ai_process_context_turns
            (process_id, ordinal, creator_agent_turn_id, created_at)
            VALUES (?, ?, ?, ?)`,
          )
          .run(processId, ordinal, turnId, startedAt);
      }
      this.appendEvent(processId, {
        eventKind: 'PROCESS_STARTED',
        attemptId,
        observedAt: startedAt,
      });
      return processId;
    })();
  }

  /**
   * A caller-supplied process id is only a correlation key. It cannot select
   * another scope or substitute a different prompt-history snapshot.
   */
  assertAgentChatOwnership(processId: string, scope: CreatorAgentScope, historyTurnIds: readonly string[]) {
    this.db.transaction(() => {
      const process = this.db
        .prepare(
          `SELECT process_kind, scope_kind, scope_id, status
          FROM ai_processes
          WHERE id = ?`,
        )
        .get(processId) as JsonMap | undefined;
      const context = this.db
        .prepare(
          `SELECT creator_agent_turn_id
          FROM ai_process_context_turns
          WHERE process_id = ?
          ORDER BY ordinal`,
        )
        .all(processId) as JsonMap[];
      const frozenHistoryTurnIds = context.map((row) => text(row.creator_agent_turn_id));
      const ownsProcess =
        process !== undefined &&
        text(process.process_kind) === 'AGENT_CHAT' &&
        text(process.status) === 'RUNNING' &&
        text(process.scope_kind) === scope.kind &&
        text(process.scope_id) === scope.id &&
        frozenHistoryTurnIds.length === historyTurnIds.length &&
        frozenHistoryTurnIds.every((turnId, index) => turnId === historyTurnIds[index]);
      if (ownsProcess) return;
      throw Object.assign(new Error('Agent chat process ownership does not match the request'), {
        code: 'AGENT_CHAT_PROCESS_MISMATCH',
      });
    })();
  }

  setTransport(processId: string, transport: AiProcessTransport) {
    this.db.transaction(() => {
      const process = this.runningProcess(processId);
      if (!process) return;
      const attempt = this.activeAttempt(processId);
      const storedTransport = transport === 'app-server' ? 'APP_SERVER' : 'CLI';
      const currentCompleteness = text(process.completeness);
      const completeness =
        currentCompleteness === 'TRUNCATED_BY_POLICY'
          ? currentCompleteness
          : transport === 'exec'
            ? 'PARTIAL_PROVIDER'
            : 'PARTIAL_CAPTURE';
      this.db.prepare('UPDATE ai_processes SET completeness = ? WHERE id = ?').run(completeness, processId);
      this.db
        .prepare('UPDATE ai_process_attempts SET transport = ?, completeness = ? WHERE id = ?')
        .run(storedTransport, completeness, attempt.id);
      this.appendEvent(processId, {
        eventKind: 'TRANSPORT_SELECTED',
        attemptId: text(attempt.id),
      });
    })();
  }

  recordExternalTurn(processId: string, threadId: string, turnId: string) {
    this.db.transaction(() => {
      if (!this.runningProcess(processId)) return;
      const attempt = this.activeAttempt(processId);
      const createdAt = now();
      const references = [
        ['THREAD_ID', bounded(threadId, 512)],
        ['TURN_ID', bounded(turnId, 512)],
      ] as const;
      for (const [kind, value] of references) {
        if (!value) continue;
        this.db
          .prepare(
            `INSERT OR IGNORE INTO ai_process_external_refs
            (id, process_id, attempt_id, provider_key, ref_kind, ref_value, created_at)
            VALUES (?, ?, ?, 'codex', ?, ?, ?)`,
          )
          .run(ulid(), processId, attempt.id, kind, value, createdAt);
      }
      this.appendEvent(processId, {
        eventKind: 'TURN_STARTED',
        attemptId: text(attempt.id),
        itemId: bounded(turnId, 512),
        observedAt: createdAt,
      });
    })();
  }

  recordObservableEvent(processId: string, input: AiProcessObservableEventInput) {
    this.db.transaction(() => {
      if (!this.runningProcess(processId)) return;
      const attempt = this.activeAttempt(processId);
      const degradationReason = bounded(input.degradationReason, 100);
      const droppedEventCount = tokenCount(input.droppedEventCount);
      if (degradationReason) {
        this.markDegraded(
          processId,
          text(attempt.id),
          droppedEventCount ?? 0,
          input.droppedEventCountExact !== false,
          degradedCompleteness(degradationReason),
        );
      }
      this.appendEvent(processId, {
        eventKind: degradationReason ? 'CAPTURE_DEGRADED' : 'PROVIDER_EVENT',
        attemptId: text(attempt.id),
        rpcMethod: bounded(input.method, 200),
        itemId: bounded(input.itemId, 512),
        itemType: bounded(input.itemType, 100),
        itemStatus: bounded(input.itemStatus, 100),
        toolKind: bounded(input.toolKind, 100),
        toolName: bounded(input.toolName, 200),
        inputTokens: tokenCount(input.usage?.inputTokens),
        cachedInputTokens: tokenCount(input.usage?.cachedInputTokens),
        outputTokens: tokenCount(input.usage?.outputTokens),
        reasoningOutputTokens: tokenCount(input.usage?.reasoningOutputTokens),
        totalTokens: tokenCount(input.usage?.totalTokens),
        degradationReason,
        droppedEventCount,
        force: Boolean(degradationReason),
      });
    })();
  }

  markCaptureDegraded(processId: string, reason: string, droppedEventCount = 0, droppedEventCountExact = true) {
    this.db.transaction(() => {
      if (!this.runningProcess(processId)) return;
      const attempt = this.activeAttempt(processId);
      const normalizedReason = safeCode(reason, 'CAPTURE_SINK_FAILED');
      const normalizedCount = tokenCount(droppedEventCount) ?? 0;
      this.markDegraded(
        processId,
        text(attempt.id),
        normalizedCount,
        droppedEventCountExact,
        degradedCompleteness(normalizedReason),
      );
      const reasonAlreadyRecorded = this.db
        .prepare('SELECT 1 FROM ai_process_events WHERE process_id = ? AND degradation_reason = ? LIMIT 1')
        .get(processId, normalizedReason);
      if (reasonAlreadyRecorded) return;
      this.appendEvent(processId, {
        eventKind: 'CAPTURE_DEGRADED',
        attemptId: text(attempt.id),
        rpcMethod: 'capture/degraded',
        degradationReason: normalizedReason,
        droppedEventCount: normalizedCount,
        force: true,
      });
    })();
  }

  succeed(processId: string, creatorAgentTurnId: string) {
    this.finish(processId, 'SUCCEEDED', 'PROCESS_COMPLETED', null, creatorAgentTurnId);
  }

  finishFromError(processId: string, error: unknown) {
    const terminal = terminalError(error);
    this.finish(
      processId,
      terminal.status,
      terminal.status === 'CANCELLED'
        ? 'PROCESS_CANCELLED'
        : terminal.status === 'INTERRUPTED'
          ? 'PROCESS_INTERRUPTED'
          : 'PROCESS_FAILED',
      terminal.code,
      null,
    );
  }

  interruptRunningAtWorkerStartup() {
    this.db.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM ai_processes WHERE status = 'RUNNING'").all() as JsonMap[];
      for (const row of rows) {
        this.finishUnsafe(text(row.id), 'INTERRUPTED', 'PROCESS_INTERRUPTED', 'MODEL_WORKER_RESTARTED', null);
      }
    })();
  }

  private finish(
    processId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED',
    eventKind: 'PROCESS_COMPLETED' | 'PROCESS_FAILED' | 'PROCESS_CANCELLED' | 'PROCESS_INTERRUPTED',
    errorCode: string | null,
    creatorAgentTurnId: string | null,
  ) {
    this.db.transaction(() => this.finishUnsafe(processId, status, eventKind, errorCode, creatorAgentTurnId))();
  }

  private finishUnsafe(
    processId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED',
    eventKind: 'PROCESS_COMPLETED' | 'PROCESS_FAILED' | 'PROCESS_CANCELLED' | 'PROCESS_INTERRUPTED',
    errorCode: string | null,
    creatorAgentTurnId: string | null,
  ) {
    if (!this.runningProcess(processId)) return;
    const attempt = this.activeAttempt(processId);
    const finishedAt = now();
    this.appendEvent(processId, {
      eventKind,
      attemptId: text(attempt.id),
      itemId: creatorAgentTurnId,
      observedAt: finishedAt,
      force: true,
    });
    this.db
      .prepare(
        `UPDATE ai_processes
        SET status = ?, creator_agent_turn_id = ?, error_code = ?, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(status, creatorAgentTurnId, errorCode, finishedAt, processId);
    this.db
      .prepare(
        `UPDATE ai_process_attempts SET status = ?, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(status, finishedAt, attempt.id);
  }

  private runningProcess(processId: string) {
    return this.db
      .prepare("SELECT status, completeness, last_event_sequence FROM ai_processes WHERE id = ? AND status = 'RUNNING'")
      .get(processId) as JsonMap | undefined;
  }

  private activeAttempt(processId: string) {
    const attempt = this.db
      .prepare('SELECT id FROM ai_process_attempts WHERE process_id = ? ORDER BY attempt_no DESC LIMIT 1')
      .get(processId) as JsonMap | undefined;
    if (!attempt) throw new Error('AI process attempt is unavailable');
    return attempt;
  }

  private markDegraded(
    processId: string,
    attemptId: string,
    droppedEventCount: number,
    droppedEventCountExact = true,
    completeness: 'PARTIAL_CAPTURE' | 'TRUNCATED_BY_POLICY' = 'PARTIAL_CAPTURE',
  ) {
    this.db
      .prepare(
        `UPDATE ai_processes
        SET completeness = CASE
              WHEN completeness = 'TRUNCATED_BY_POLICY' OR ? = 'TRUNCATED_BY_POLICY'
                THEN 'TRUNCATED_BY_POLICY'
              ELSE 'PARTIAL_CAPTURE'
            END,
            dropped_event_count = dropped_event_count + ?,
            dropped_event_count_exact = dropped_event_count_exact AND ?
        WHERE id = ?`,
      )
      .run(completeness, droppedEventCount, droppedEventCountExact ? 1 : 0, processId);
    this.db
      .prepare(
        `UPDATE ai_process_attempts
        SET completeness = CASE
              WHEN completeness = 'TRUNCATED_BY_POLICY' OR ? = 'TRUNCATED_BY_POLICY'
                THEN 'TRUNCATED_BY_POLICY'
              ELSE 'PARTIAL_CAPTURE'
            END,
            dropped_event_count = dropped_event_count + ?,
            dropped_event_count_exact = dropped_event_count_exact AND ?
        WHERE id = ?`,
      )
      .run(completeness, droppedEventCount, droppedEventCountExact ? 1 : 0, attemptId);
  }

  private appendEvent(
    processId: string,
    input: {
      eventKind: string;
      attemptId: string;
      rpcMethod?: string | null;
      itemId?: string | null;
      itemType?: string | null;
      itemStatus?: string | null;
      toolKind?: string | null;
      toolName?: string | null;
      inputTokens?: number | null;
      cachedInputTokens?: number | null;
      outputTokens?: number | null;
      reasoningOutputTokens?: number | null;
      totalTokens?: number | null;
      degradationReason?: string | null;
      droppedEventCount?: number | null;
      observedAt?: string;
      force?: boolean;
    },
  ) {
    const process = this.db
      .prepare('SELECT status, completeness, last_event_sequence FROM ai_processes WHERE id = ?')
      .get(processId) as JsonMap | undefined;
    if (!process) throw new Error('AI process is unavailable');
    if (TERMINAL_STATUSES.has(text(process.status)) && !input.force) return;
    const currentSequence = Number(process.last_event_sequence) || 0;
    if (!input.force && currentSequence >= MAX_OBSERVABLE_EVENT_HEADERS) {
      this.markDegraded(processId, input.attemptId, 1, true, 'TRUNCATED_BY_POLICY');
      const budgetEventExists = this.db
        .prepare(
          "SELECT 1 FROM ai_process_events WHERE process_id = ? AND degradation_reason = 'EVENT_HEADER_BUDGET_REACHED' LIMIT 1",
        )
        .get(processId);
      if (!budgetEventExists) {
        this.insertEvent(processId, currentSequence + 1, {
          eventKind: 'CAPTURE_DEGRADED',
          attemptId: input.attemptId,
          degradationReason: 'EVENT_HEADER_BUDGET_REACHED',
          droppedEventCount: 1,
        });
      }
      return;
    }
    this.insertEvent(processId, currentSequence + 1, input);
  }

  private insertEvent(
    processId: string,
    sequence: number,
    input: {
      eventKind: string;
      attemptId: string;
      rpcMethod?: string | null;
      itemId?: string | null;
      itemType?: string | null;
      itemStatus?: string | null;
      toolKind?: string | null;
      toolName?: string | null;
      inputTokens?: number | null;
      cachedInputTokens?: number | null;
      outputTokens?: number | null;
      reasoningOutputTokens?: number | null;
      totalTokens?: number | null;
      degradationReason?: string | null;
      droppedEventCount?: number | null;
      observedAt?: string;
    },
  ) {
    this.db
      .prepare(
        `INSERT INTO ai_process_events
        (id, process_id, attempt_id, sequence, event_kind, rpc_method, item_id, item_type, item_status,
         tool_kind, tool_name, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
         total_tokens, degradation_reason, dropped_event_count, observed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        processId,
        input.attemptId,
        sequence,
        input.eventKind,
        input.rpcMethod ?? null,
        input.itemId ?? null,
        input.itemType ?? null,
        input.itemStatus ?? null,
        input.toolKind ?? null,
        input.toolName ?? null,
        input.inputTokens ?? null,
        input.cachedInputTokens ?? null,
        input.outputTokens ?? null,
        input.reasoningOutputTokens ?? null,
        input.totalTokens ?? null,
        input.degradationReason ?? null,
        input.droppedEventCount ?? null,
        input.observedAt ?? now(),
      );
    this.db.prepare('UPDATE ai_processes SET last_event_sequence = ? WHERE id = ?').run(sequence, processId);
  }
}
