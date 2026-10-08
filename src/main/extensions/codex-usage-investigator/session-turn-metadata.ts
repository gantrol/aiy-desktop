import { z } from 'zod';
import type { CodexUsageServiceTier } from '@/shared/contracts/codex-usage';
import { normalizeCodexUsageModel } from '@/main/extensions/codex-usage-investigator/pricing';
import { codexUuidV7Timestamp } from '@/main/extensions/codex-usage-investigator/turn-identity';

const lineageSchema = z.object({
  id: z.string().min(1).max(512),
  forked_from_id: z.string().min(1).max(512).nullable().optional(),
  parent_thread_id: z.string().min(1).max(512).nullable().optional(),
});

export interface SessionLineageRecord {
  kind: 'LINEAGE';
  sessionId: string;
  inherited: boolean;
}

export interface MutableChatTurn {
  turnId: string;
  startedAt: string | null;
  terminalAt: string | null;
  terminalState: 'COMPLETED' | 'ABORTED' | null;
  durationMs: number | null;
  models: Set<string>;
  reasoningEfforts: Set<string>;
}

/** Shared by usage records until reverse reading reaches their turn's context or start. */
export class CodexUsageTurnScope {
  private conflicting = false;

  constructor(public turnId: string | null = null) {}

  bind(turnId: string) {
    if (this.conflicting) return;
    if (this.turnId !== null && this.turnId !== turnId) {
      this.turnId = null;
      this.conflicting = true;
    } else this.turnId = turnId;
  }
}

export type ChatTurnTimingEvent =
  | { kind: 'TURN_STARTED'; turnId: string; timestamp: string }
  | {
      kind: 'TURN_TERMINAL';
      turnId: string;
      timestamp: string;
      terminalState: 'COMPLETED' | 'ABORTED';
      durationMs: number | null;
    };

export function parseSessionLineage(payload: unknown): SessionLineageRecord | { kind: 'IGNORED' } {
  const lineage = lineageSchema.safeParse(payload);
  return lineage.success
    ? {
        kind: 'LINEAGE',
        sessionId: lineage.data.id,
        inherited: Boolean(lineage.data.forked_from_id || lineage.data.parent_thread_id),
      }
    : { kind: 'IGNORED' };
}

export class CodexSessionLineage {
  private inherited = false;
  private firstOwnedTurnReverseOrder: number | null = null;
  private readonly createdMs: number;

  constructor(
    private readonly sessionId: string,
    threadCreatedMs: number,
  ) {
    this.createdMs = codexUuidV7Timestamp(sessionId) ?? threadCreatedMs;
  }

  addMetadata(record: SessionLineageRecord) {
    if (record.sessionId === this.sessionId) this.inherited = record.inherited;
  }

  addTurn(record: ChatTurnTimingEvent, reverseOrder: number) {
    if (record.kind !== 'TURN_STARTED') return;
    const createdMs = codexUuidV7Timestamp(record.turnId);
    if (createdMs !== null && this.createdMs > 0 && createdMs >= this.createdMs) {
      this.firstOwnedTurnReverseOrder = reverseOrder;
    }
  }

  get inheritedBeforeReverseOrder() {
    return this.inherited ? this.firstOwnedTurnReverseOrder : null;
  }
}

export function applyChatTurnTiming(turn: MutableChatTurn, record: ChatTurnTimingEvent) {
  if (record.kind === 'TURN_STARTED') {
    if (turn.startedAt === null || record.timestamp < turn.startedAt) turn.startedAt = record.timestamp;
  } else if (turn.terminalAt === null || record.timestamp > turn.terminalAt) {
    turn.terminalAt = record.timestamp;
    turn.terminalState = record.terminalState;
    turn.durationMs = record.durationMs;
  }
}

export function normalizeChatTurns(
  sessionId: string,
  turns: ReadonlyMap<string, MutableChatTurn>,
  observedServiceTiers: ReadonlyMap<string, CodexUsageServiceTier>,
) {
  return [...turns.values()]
    .filter((turn) => turn.startedAt !== null || turn.terminalAt !== null)
    .sort(
      (left, right) =>
        (left.startedAt ?? left.terminalAt ?? '').localeCompare(right.startedAt ?? right.terminalAt ?? '') ||
        left.turnId.localeCompare(right.turnId),
    )
    .map((turn, turnOrder) => ({
      sessionId,
      turnOrder,
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      terminalAt: turn.terminalAt,
      terminalState: turn.terminalState,
      durationMs: turn.durationMs,
      model: turn.models.size === 1 ? normalizeCodexUsageModel([...turn.models][0]!) : null,
      reasoningEffort: turn.reasoningEfforts.size === 1 ? [...turn.reasoningEfforts][0]!.trim().toLowerCase() : null,
      serviceTier: observedServiceTiers.get(turn.turnId) ?? 'UNKNOWN',
    }));
}

export function observedTurnServiceTiers(
  events: readonly { turnId: string | null; serviceTier: CodexUsageServiceTier }[],
) {
  const observed = new Map<string, Set<Exclude<CodexUsageServiceTier, 'UNKNOWN'>>>();
  for (const event of events) {
    if (!event.turnId || event.serviceTier === 'UNKNOWN') continue;
    const tiers = observed.get(event.turnId) ?? new Set<Exclude<CodexUsageServiceTier, 'UNKNOWN'>>();
    tiers.add(event.serviceTier);
    observed.set(event.turnId, tiers);
  }
  return new Map(
    [...observed].map(([turnId, tiers]) => [turnId, tiers.size === 1 ? [...tiers][0]! : ('UNKNOWN' as const)]),
  );
}
