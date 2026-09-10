import { z } from 'zod';
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
