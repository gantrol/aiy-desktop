import type { CodexOutputThroughput } from '@/shared/contracts/codex-output-throughput';

export function emptyCodexOutputThroughput(partial = false): CodexOutputThroughput {
  return {
    outputTokens: 0,
    durationMs: 0,
    pairedTurnCount: 0,
    completedTurnCount: 0,
    abortedTurnCount: 0,
    missingUsageTurnCount: 0,
    invalidDurationTurnCount: 0,
    partial,
  };
}

export function codexTurnDuration(startedMs: number | null, terminalMs: number | null, durationMs: number | null) {
  if (terminalMs === null || (startedMs !== null && terminalMs < startedMs)) return null;
  const duration = durationMs ?? (startedMs === null ? null : terminalMs - startedMs);
  return duration !== null && Number.isSafeInteger(duration) && duration >= 0 ? duration : null;
}

export function addCodexOutputTurn(
  summary: CodexOutputThroughput,
  turn: {
    terminalState: 'COMPLETED' | 'ABORTED' | null;
    durationMs: number | null;
    outputTokens: number | null;
  },
) {
  if (turn.terminalState === null) return;
  if (turn.terminalState === 'COMPLETED') summary.completedTurnCount += 1;
  else summary.abortedTurnCount += 1;
  if (turn.durationMs === null || !Number.isSafeInteger(turn.durationMs) || turn.durationMs < 0) {
    summary.invalidDurationTurnCount += 1;
    summary.partial = true;
    return;
  }
  if (
    turn.outputTokens === null ||
    !Number.isSafeInteger(turn.outputTokens) ||
    turn.outputTokens < 0 ||
    !Number.isSafeInteger(summary.outputTokens + turn.outputTokens) ||
    !Number.isSafeInteger(summary.durationMs + turn.durationMs)
  ) {
    summary.missingUsageTurnCount += 1;
    summary.partial = true;
    return;
  }
  summary.outputTokens += turn.outputTokens;
  summary.durationMs += turn.durationMs;
  summary.pairedTurnCount += 1;
}

export function codexOutputTokensPerSecond(summary: CodexOutputThroughput | null | undefined) {
  if (!summary?.pairedTurnCount || summary.durationMs <= 0) return null;
  const speed = summary.outputTokens / (summary.durationMs / 1_000);
  return Number.isFinite(speed) ? speed : null;
}

export function combineCodexOutputThroughput(summaries: readonly CodexOutputThroughput[]) {
  const result = emptyCodexOutputThroughput();
  for (const summary of summaries) {
    for (const key of Object.keys(result) as (keyof CodexOutputThroughput)[]) {
      if (key === 'partial') result.partial ||= summary.partial;
      else {
        if (!Number.isSafeInteger(result[key] + summary[key])) return null;
        result[key] += summary[key];
      }
    }
  }
  return result;
}
