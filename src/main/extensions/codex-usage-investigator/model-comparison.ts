import type Database from 'better-sqlite3';
import { z } from 'zod';
import modelComparisonEventsSql from '@/main/database/sql/codex-model-comparison-events.sql?raw';
import {
  codexModelComparisonAnalysisSchema,
  type CodexModelComparisonRow,
  type CodexModelComparisonSample,
} from '@/shared/contracts/codex-model-comparison';
import { codexModelComparisonDistribution as distribution } from '@/shared/codex-model-comparison-distribution';
import { codexUsageServiceTierSchema } from '@/shared/contracts/codex-usage';
import { estimateCodexUsage, normalizeCodexUsageModel } from '@/main/extensions/codex-usage-investigator/pricing';

const PAGE_SIZE = 2_000;
const MAX_TURNS = 100_000;
const MAX_GROUPS = 1_000;
const count = z.number().int().nonnegative().safe();
const eventRowSchema = z
  .object({
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    terminalMs: count,
    durationMs: count.nullable(),
    turnModel: z.string().min(1).max(200).nullable(),
    reasoningEffort: z.string().min(1).max(100).nullable(),
    serviceTier: codexUsageServiceTierSchema,
    eventOrder: z.number().int().min(-1).safe(),
    timestamp: z.string().datetime().nullable(),
    eventModel: z.string().min(1).max(200).nullable(),
    eventServiceTier: codexUsageServiceTierSchema.nullable(),
    inputTokens: count,
    cachedInputTokens: count,
    cacheWriteInputTokens: count,
    outputTokens: count,
    reasoningOutputTokens: count,
    totalTokens: count,
  })
  .strict();
type EventRow = z.infer<typeof eventRowSchema>;

interface TurnSample {
  sessionId: string;
  turnId: string;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: EventRow['serviceTier'];
  terminalMs: number;
  durationMs: number | null;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  outputTokens: number;
  apiUsd: number | null;
  credits: number | null;
}

function createSample(row: EventRow): TurnSample {
  return {
    sessionId: row.sessionId,
    turnId: row.turnId,
    model: row.turnModel ? normalizeCodexUsageModel(row.turnModel) : null,
    reasoningEffort: row.reasoningEffort,
    serviceTier: row.serviceTier,
    terminalMs: row.terminalMs,
    durationMs: row.durationMs && row.durationMs > 0 ? row.durationMs : null,
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    outputTokens: 0,
    apiUsd: 0,
    credits: 0,
  };
}

function addEvent(sample: TurnSample, row: EventRow) {
  if (row.totalTokens === 0 || !row.timestamp || !row.eventModel) return;
  const model = normalizeCodexUsageModel(row.eventModel);
  if (sample.model !== model) sample.model = null;
  const estimate = estimateCodexUsage(model, row, row.eventServiceTier ?? 'UNKNOWN', row.timestamp);
  sample.requests += 1;
  sample.inputTokens += row.inputTokens;
  sample.cachedInputTokens += row.cachedInputTokens;
  sample.totalTokens += row.totalTokens;
  sample.outputTokens += row.outputTokens;
  sample.apiUsd =
    sample.apiUsd === null || estimate.apiEquivalentUsd === null ? null : sample.apiUsd + estimate.apiEquivalentUsd;
  sample.credits =
    sample.credits === null || estimate.codexCredits === null || row.cacheWriteInputTokens > 0
      ? null
      : sample.credits + estimate.codexCredits;
}

function summarize(
  samples: TurnSample[],
  splitEffort: boolean,
): { rows: CodexModelComparisonRow[]; truncated: boolean } {
  const groups = new Map<string, TurnSample[]>();
  for (const sample of samples) {
    if (!sample.model) continue;
    const key = JSON.stringify([sample.model, splitEffort ? sample.reasoningEffort : null, sample.serviceTier]);
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((left, right) => {
    const a = left[0]!;
    const b = right[0]!;
    return (
      a.model!.localeCompare(b.model!) ||
      a.serviceTier.localeCompare(b.serviceTier) ||
      (splitEffort ? (a.reasoningEffort ?? '').localeCompare(b.reasoningEffort ?? '') : 0)
    );
  });
  // Bound quantile construction as well as the returned payload.
  const rows = ordered.slice(0, MAX_GROUPS).map((group) => {
    const first = group[0]!;
    const usage = group.filter((sample) => sample.requests > 0);
    const input = usage.reduce((sum, sample) => sum + sample.inputTokens, 0);
    const distributions = {
      durationMs: distribution(group.map((sample) => sample.durationMs)),
      requests: distribution(usage.map((sample) => sample.requests)),
      totalTokens: distribution(usage.map((sample) => sample.totalTokens)),
      outputTokens: distribution(usage.map((sample) => sample.outputTokens)),
      apiEquivalentUsd: distribution(usage.map((sample) => sample.apiUsd)),
      codexCredits: distribution(usage.map((sample) => sample.credits)),
    };
    return {
      model: first.model!,
      reasoningEffort: splitEffort ? first.reasoningEffort : null,
      serviceTier: first.serviceTier,
      completedTurnCount: group.length,
      sessionCount: new Set(group.map((sample) => sample.sessionId)).size,
      durationTurnCount: distributions.durationMs?.sampleCount ?? 0,
      usageTurnCount: usage.length,
      apiPricedTurnCount: distributions.apiEquivalentUsd?.sampleCount ?? 0,
      creditPricedTurnCount: distributions.codexCredits?.sampleCount ?? 0,
      medianDurationMs: distributions.durationMs?.percentiles[50] ?? null,
      medianRequests: distributions.requests?.percentiles[50] ?? null,
      medianTotalTokens: distributions.totalTokens?.percentiles[50] ?? null,
      medianOutputTokens: distributions.outputTokens?.percentiles[50] ?? null,
      medianApiEquivalentUsd: distributions.apiEquivalentUsd?.percentiles[50] ?? null,
      medianCodexCredits: distributions.codexCredits?.percentiles[50] ?? null,
      distributions,
      samples: splitEffort
        ? group.map((sample): CodexModelComparisonSample => [
            sample.terminalMs,
            sample.durationMs,
            sample.requests > 0 ? sample.requests : null,
            sample.requests > 0 ? sample.totalTokens : null,
            sample.requests > 0 ? sample.outputTokens : null,
            sample.requests > 0 ? sample.apiUsd : null,
            sample.requests > 0 ? sample.credits : null,
          ])
        : null,
      cachedInputPercent:
        input > 0 ? (usage.reduce((sum, sample) => sum + sample.cachedInputTokens, 0) / input) * 100 : null,
    };
  });
  return { rows, truncated: groups.size > MAX_GROUPS };
}

export async function readCodexModelComparison(
  database: Database.Database,
  fromEpoch: number | null,
  toEpoch: number,
  signal?: AbortSignal,
) {
  const statement = database.prepare(modelComparisonEventsSql);
  const samples: TurnSample[] = [];
  let current: TurnSample | null = null;
  let cursor = { terminalMs: -1, sessionId: '', turnId: '', eventOrder: -1 };
  let samplesTruncated = false;
  scan: while (true) {
    if (signal?.aborted) throw Object.assign(new Error('Codex usage scan cancelled'), { name: 'AbortError' });
    const rows = z
      .array(eventRowSchema)
      .max(PAGE_SIZE)
      .parse(statement.all({ fromEpoch, toEpoch, ...cursor, pageSize: PAGE_SIZE }));
    if (!rows.length) break;
    for (const row of rows) {
      if (current?.turnId !== row.turnId || current?.sessionId !== row.sessionId) {
        if (current) samples.push(current);
        current = null;
        if (samples.length >= MAX_TURNS) {
          samplesTruncated = true;
          break scan;
        }
        current = createSample(row);
      }
      addEvent(current, row);
    }
    const last = rows.at(-1)!;
    cursor = {
      terminalMs: last.terminalMs,
      sessionId: last.sessionId,
      turnId: last.turnId,
      eventOrder: last.eventOrder,
    };
    if (rows.length < PAGE_SIZE) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (current) samples.push(current);
  const byModel = summarize(samples, false);
  const byReasoningEffort = summarize(samples, true);
  return codexModelComparisonAnalysisSchema.parse({
    definition: 'OWNED_USER_COMPLETED_TURNS',
    algorithmVersion: 2,
    rangeAssignment: 'COMPLETION_TIMESTAMP',
    completedTurnCount: samples.length,
    excludedModelTurnCount: samples.filter((sample) => !sample.model).length,
    samplesTruncated: samplesTruncated || byModel.truncated || byReasoningEffort.truncated,
    byModel: byModel.rows,
    byReasoningEffort: byReasoningEffort.rows,
  });
}
