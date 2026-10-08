import { codexTurnBelongsToThread } from '@/main/extensions/codex-usage-investigator/turn-identity';
import type { SessionReadResult } from '@/main/extensions/codex-usage-investigator/session-reader';
import { addCodexOutputTurn, codexTurnDuration, emptyCodexOutputThroughput } from '@/shared/codex-output-throughput';

export function summarizeThreadThroughput(result: SessionReadResult, createdAtMs: number | null, stable: boolean) {
  const complete =
    stable &&
    createdAtMs !== null &&
    result.turnMetadataComplete &&
    result.invalidRecords === 0 &&
    result.oversizedRecords === 0;
  const summary = emptyCodexOutputThroughput(!complete || !result.turnMetadataComplete);
  const outputs = new Map<string, number>();
  const invalidTurns = new Set<string>();
  const turns = new Map(result.chatTurns.map((turn) => [turn.turnId, turn]));
  let unassignedUsage = false;
  for (const event of result.events) {
    const timestamp = Date.parse(event.timestamp);
    if (createdAtMs !== null && timestamp < createdAtMs) continue;
    // Zero-token quota observations do not prove that a turn's output was recorded.
    if (event.usage.totalTokens === 0) continue;
    const turn = event.turnId ? turns.get(event.turnId) : null;
    if (!turn) {
      unassignedUsage = true;
      continue;
    }
    if (
      !turn.startedAt ||
      timestamp < Date.parse(turn.startedAt) ||
      (turn.terminalAt && timestamp > Date.parse(turn.terminalAt))
    ) {
      invalidTurns.add(turn.turnId);
    }
    outputs.set(turn.turnId, (outputs.get(turn.turnId) ?? 0) + event.usage.outputTokens);
  }
  const seen = new Set<string>();
  for (const turn of result.chatTurns) {
    const startedMs = turn.startedAt === null ? null : Date.parse(turn.startedAt);
    const terminalMs = turn.terminalAt === null ? null : Date.parse(turn.terminalAt);
    if (seen.has(turn.turnId) || !codexTurnBelongsToThread(turn.turnId, startedMs, terminalMs, createdAtMs)) continue;
    seen.add(turn.turnId);
    addCodexOutputTurn(summary, {
      terminalState: turn.terminalState,
      durationMs: codexTurnDuration(startedMs, turn.terminalAt ? Date.parse(turn.terminalAt) : null, turn.durationMs),
      outputTokens:
        complete && !unassignedUsage && !invalidTurns.has(turn.turnId) ? (outputs.get(turn.turnId) ?? null) : null,
    });
  }
  return summary;
}
