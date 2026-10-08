import type Database from 'better-sqlite3';
import { z } from 'zod';
import throughputSql from '@/main/database/sql/codex-output-throughput.sql?raw';
import ownedTurnsSql from '@/main/database/sql/codex-owned-user-turns.sql?raw';
import {
  codexOutputThroughputAnalysisSchema,
  type CodexOutputThroughput,
  type CodexOutputThroughputGroup,
} from '@/shared/contracts/codex-output-throughput';
import { addCodexOutputTurn, codexTurnDuration, emptyCodexOutputThroughput } from '@/shared/codex-output-throughput';
import { normalizeCodexUsageModel } from '@/main/extensions/codex-usage-investigator/pricing';

const PAGE_SIZE = 500;
const MAX_TURNS = 100_000;
const MAX_GROUPS = 1_000;
const count = z.number().int().nonnegative().safe();
const rowSchema = z.object({
  sessionId: z.string(),
  turnId: z.string(),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
  startedMs: count.nullable(),
  terminalMs: count,
  terminalState: z.enum(['COMPLETED', 'ABORTED']),
  durationMs: count.nullable(),
  outputTokens: count.nullable(),
  partial: z.union([z.literal(0), z.literal(1)]),
  importedAt: z.string().datetime(),
});

export async function readCodexOutputThroughput(
  database: Database.Database,
  options: {
    fromEpoch: number | null;
    toEpoch: number;
    sessionIds?: readonly string[];
    signal?: AbortSignal;
    updatedAfter?: ReadonlyMap<string, number>;
  },
) {
  const statement = database.prepare(`${ownedTurnsSql}${throughputSql}`);
  const overall = emptyCodexOutputThroughput();
  const sessions = new Map<string, CodexOutputThroughput>();
  const groups = new Map<string, CodexOutputThroughputGroup>();
  let cursor = { sessionId: '', turnId: '' };
  let count = 0;
  let truncated = false;
  let limitReached = false;
  while (true) {
    options.signal?.throwIfAborted();
    const rows = z
      .array(rowSchema)
      .max(PAGE_SIZE)
      .parse(
        statement.all({
          fromEpoch: options.fromEpoch,
          toEpoch: options.toEpoch,
          sessionIds: options.sessionIds ? JSON.stringify(options.sessionIds) : null,
          ...cursor,
          pageSize: Math.min(PAGE_SIZE, MAX_TURNS - count + 1),
        }),
      );
    for (const row of rows) {
      if (count >= MAX_TURNS) {
        truncated = true;
        limitReached = true;
        break;
      }
      count += 1;
      const turn = { ...row, durationMs: codexTurnDuration(row.startedMs, row.terminalMs, row.durationMs) };
      const session = sessions.get(row.sessionId) ?? emptyCodexOutputThroughput();
      const model = row.model ? normalizeCodexUsageModel(row.model) : null;
      const key = JSON.stringify([model, row.reasoningEffort, row.serviceTier]);
      const group = groups.get(key) ?? {
        model,
        reasoningEffort: row.reasoningEffort,
        serviceTier: row.serviceTier,
        throughput: emptyCodexOutputThroughput(),
      };
      for (const summary of [overall, session, group.throughput]) {
        summary.partial ||=
          row.partial === 1 || Date.parse(row.importedAt) < (options.updatedAfter?.get(row.sessionId) ?? 0);
        addCodexOutputTurn(summary, turn);
      }
      sessions.set(row.sessionId, session);
      if (groups.has(key) || groups.size < MAX_GROUPS) groups.set(key, group);
      else truncated = true;
    }
    if (limitReached || rows.length < PAGE_SIZE) break;
    const last = rows.at(-1)!;
    cursor = { sessionId: last.sessionId, turnId: last.turnId };
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (truncated) {
    overall.partial = true;
    for (const summary of sessions.values()) summary.partial = true;
    for (const group of groups.values()) group.throughput.partial = true;
  }
  return {
    sessions,
    analysis: codexOutputThroughputAnalysisSchema.parse({ overall, groups: [...groups.values()], truncated }),
  };
}
