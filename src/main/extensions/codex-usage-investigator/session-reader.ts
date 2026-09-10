import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import type { CodexUsageQuotaKind, CodexUsageServiceTier } from '@/shared/contracts/codex-usage';
import { normalizeCodexUsageModel, type CodexUsageBreakdown } from '@/main/extensions/codex-usage-investigator/pricing';
import {
  applyChatTurnTiming,
  CodexSessionLineage,
  parseSessionLineage,
  type ChatTurnTimingEvent,
  type MutableChatTurn,
  type SessionLineageRecord,
} from '@/main/extensions/codex-usage-investigator/session-turn-metadata';
import {
  inferredServiceTier,
  type CodexUsageServiceTierFallback,
} from '@/main/extensions/codex-usage-investigator/service-tier-fallback';

const READ_CHUNK_BYTES = 256 * 1024;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_USAGE_EVENTS = 10_000;
const MAX_CHAT_TURNS = 100_000;
const MAX_ENVELOPE_PREFIX_BYTES = 4 * 1024;
const TOKEN_COUNT_MARKER = Buffer.from('"token_count"');
const TURN_CONTEXT_MARKER = Buffer.from('"turn_context"');
const THREAD_SETTINGS_MARKER = Buffer.from('"thread_settings_applied"');
const TASK_STARTED_MARKER = Buffer.from('"task_started"');
const TASK_COMPLETE_MARKER = Buffer.from('"task_complete"');
const TURN_ABORTED_MARKER = Buffer.from('"turn_aborted"');
const COMPACTED_MARKER = Buffer.from('"type":"compacted"');
const SESSION_META_MARKER = Buffer.from('"session_meta"');

const safeTokenSchema = z.number().int().nonnegative().safe();
const rowEnvelopeSchema = z
  .object({
    type: z.string().max(100),
    payload: z
      .object({ type: z.string().max(100).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const rolloutTokenUsageSchema = z
  .object({
    input_tokens: safeTokenSchema,
    cached_input_tokens: safeTokenSchema.default(0),
    cache_write_input_tokens: safeTokenSchema.default(0),
    output_tokens: safeTokenSchema,
    reasoning_output_tokens: safeTokenSchema.default(0),
    total_tokens: safeTokenSchema,
  })
  .passthrough();

const rateLimitWindowSchema = z
  .object({
    used_percent: z.number().finite().nonnegative(),
    window_minutes: z.number().finite().nonnegative().nullable().optional(),
    resets_at: z.number().int().nonnegative().safe().nullable().optional(),
  })
  .passthrough();

const rateLimitsSchema = z
  .object({
    limit_id: z.string().trim().max(512).nullable().optional(),
    limit_name: z.string().trim().max(2_000).nullable().optional(),
    plan_type: z.string().trim().max(2_000).nullable().optional(),
    primary: rateLimitWindowSchema.nullable().optional(),
    secondary: rateLimitWindowSchema.nullable().optional(),
  })
  .passthrough();

const tokenCountRowSchema = z
  .object({
    timestamp: z.string().min(1).max(100),
    type: z.literal('event_msg'),
    payload: z
      .object({
        type: z.literal('token_count'),
        info: z
          .object({
            last_token_usage: rolloutTokenUsageSchema.nullable().optional(),
            total_token_usage: rolloutTokenUsageSchema.nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        rate_limits: rateLimitsSchema.nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const threadSettingsRowSchema = z
  .object({
    timestamp: z.string().min(1).max(100),
    type: z.literal('event_msg'),
    payload: z
      .object({
        type: z.literal('thread_settings_applied'),
        thread_settings: z
          .object({
            model: z.string().trim().min(1).max(200).nullable().optional(),
            model_provider_id: z.string().trim().min(1).max(200).nullable().optional(),
            service_tier: z.string().trim().min(1).max(100).nullable().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const turnContextRowSchema = z
  .object({
    timestamp: z.string().min(1).max(100),
    type: z.literal('turn_context'),
    payload: z
      .object({
        model: z.string().trim().min(1).max(200),
        turn_id: z.string().trim().min(1).max(512),
        effort: z.string().trim().min(1).max(100).nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const taskStartedRowSchema = z
  .object({
    timestamp: z.string().min(1).max(100),
    type: z.literal('event_msg'),
    payload: z
      .object({
        type: z.literal('task_started'),
        turn_id: z.string().trim().min(1).max(512),
      })
      .passthrough(),
  })
  .passthrough();

const taskTerminalRowSchema = z
  .object({
    timestamp: z.string().min(1).max(100),
    type: z.literal('event_msg'),
    payload: z
      .object({
        type: z.enum(['task_complete', 'turn_aborted']),
        turn_id: z.string().trim().min(1).max(512),
        duration_ms: safeTokenSchema.nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const compactedRowSchema = z
  .object({
    timestamp: z.string().min(1).max(100),
    type: z.literal('compacted'),
  })
  .passthrough();

const internalUsageSchema = z
  .object({
    inputTokens: safeTokenSchema,
    cachedInputTokens: safeTokenSchema,
    cacheWriteInputTokens: safeTokenSchema,
    outputTokens: safeTokenSchema,
    reasoningOutputTokens: safeTokenSchema,
    totalTokens: safeTokenSchema,
  })
  .strict();

export const codexUsageInternalRowSchema = z
  .object({
    sessionId: z.string().min(1).max(512),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    model: z.string().min(1).max(200),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']).default('UNKNOWN'),
    inferredServiceTierTokens: safeTokenSchema.default(0),
    quotaKind: z.enum(['MAIN', 'SEPARATE', 'UNKNOWN']).default('UNKNOWN'),
    firstAt: z.string().datetime(),
    lastAt: z.string().datetime(),
    requestCount: safeTokenSchema,
    usage: internalUsageSchema,
    apiEquivalentUsd: z.number().finite().nonnegative().nullable(),
    apiCacheSavingsUsd: z.number().finite().nonnegative().nullable(),
    codexCredits: z.number().finite().nonnegative().nullable(),
    codexCreditCacheSavings: z.number().finite().nonnegative().nullable().default(null),
    apiPricedTokens: safeTokenSchema,
    creditPricedTokens: safeTokenSchema,
    longContextRequestCount: safeTokenSchema,
  })
  .strict();

export const codexUsageInternalEventSchema = z
  .object({
    sessionId: z.string().min(1).max(512),
    eventFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    turnId: z.string().min(1).max(512).nullable(),
    timestamp: z.string().datetime(),
    model: z.string().min(1).max(200),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
    serviceTierInferred: z.boolean().default(false),
    quotaKind: z.enum(['MAIN', 'SEPARATE', 'UNKNOWN']),
    limitId: z.string().max(512).nullable(),
    planType: z.string().max(2_000).nullable(),
    usedPercent: z.number().finite().nonnegative().nullable(),
    windowDurationMins: z.number().finite().nonnegative().nullable(),
    resetsAt: z.number().int().nonnegative().safe().nullable(),
    secondaryUsedPercent: z.number().finite().nonnegative().nullable().default(null),
    secondaryWindowDurationMins: z.number().finite().nonnegative().nullable().default(null),
    secondaryResetsAt: z.number().int().nonnegative().safe().nullable().default(null),
    usage: internalUsageSchema,
  })
  .strict();

export const codexUsageInternalChatTurnSchema = z
  .object({
    sessionId: z.string().min(1).max(512),
    turnOrder: safeTokenSchema,
    turnId: z.string().min(1).max(512),
    startedAt: z.string().datetime(),
    terminalAt: z.string().datetime().nullable(),
    terminalState: z.enum(['COMPLETED', 'ABORTED']).nullable(),
    durationMs: safeTokenSchema.nullable(),
    model: z.string().min(1).max(200).nullable(),
    reasoningEffort: z.string().min(1).max(100).nullable(),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
  })
  .strict();

export const codexUsageSessionReadResultSchema = z
  .object({
    events: z.array(codexUsageInternalEventSchema).max(100_000),
    chatTurns: z.array(codexUsageInternalChatTurnSchema).max(MAX_CHAT_TURNS),
    contextCompactionCount: safeTokenSchema,
    turnMetadataComplete: z.boolean(),
    invalidRecords: safeTokenSchema,
    oversizedRecords: safeTokenSchema,
    bytesRead: safeTokenSchema,
  })
  .strict();

export type CodexUsageInternalRow = z.infer<typeof codexUsageInternalRowSchema>;
export type CodexUsageInternalEvent = z.infer<typeof codexUsageInternalEventSchema>;
export type CodexUsageInternalChatTurn = z.infer<typeof codexUsageInternalChatTurnSchema>;
export type SessionReadResult = z.infer<typeof codexUsageSessionReadResultSchema>;

interface ReverseReadStats {
  bytesRead: number;
  oversizedRecords: number;
}

interface PendingUsage {
  timestamp: string;
  usage: CodexUsageBreakdown;
  cumulativeUsage: CodexUsageBreakdown | null;
  reverseOrder: number;
  quotaKind: CodexUsageQuotaKind;
  limitId: string | null;
  planType: string | null;
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
  secondaryUsedPercent: number | null;
  secondaryWindowDurationMins: number | null;
  secondaryResetsAt: number | null;
}

interface PendingUsageGroup {
  model: string;
  turnId: string | null;
  events: PendingUsage[];
}

interface SessionUsageCandidate {
  event: Omit<CodexUsageInternalEvent, 'eventFingerprint'>;
  cumulativeUsage: CodexUsageBreakdown | null;
  reverseOrder: number;
}

type ParsedSessionLine =
  | { kind: 'IGNORED' }
  | SessionLineageRecord
  | ChatTurnTimingEvent
  | { kind: 'INVALID' }
  | { kind: 'COMPACTION'; timestamp: { epoch: number; iso: string } }
  | { kind: 'TOKEN'; row: z.infer<typeof tokenCountRowSchema>; timestamp: { epoch: number; iso: string } }
  | { kind: 'CONTEXT'; model: string; reasoningEffort: string | null; turnId: string }
  | { kind: 'SETTINGS'; model: string | null; serviceTier: CodexUsageServiceTier; serviceTierInferred: boolean };

type ParsedTokenLine = Extract<ParsedSessionLine, { kind: 'TOKEN' }>;
type TokenCollectionStatus = 'IGNORED' | 'BELOW_RANGE' | 'ADDED' | 'OVERFLOW';

function abortError() {
  return Object.assign(new Error('Codex usage scan cancelled'), { name: 'AbortError' });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

async function* reverseJsonLines(
  filePath: string,
  stats: ReverseReadStats,
  signal?: AbortSignal,
  onBytesRead?: (bytes: number) => void,
) {
  const handle = await open(filePath, 'r');
  try {
    const file = await handle.stat();
    let position = file.size;
    let carry = Buffer.alloc(0);
    let discardingOversizedRecord = false;
    while (position > 0) {
      throwIfAborted(signal);
      const requested = Math.min(READ_CHUNK_BYTES, position);
      position -= requested;
      const buffer = Buffer.allocUnsafe(requested);
      const { bytesRead } = await handle.read(buffer, 0, requested, position);
      if (!bytesRead) break;
      stats.bytesRead += bytesRead;
      onBytesRead?.(bytesRead);
      let chunk = buffer.subarray(0, bytesRead);
      if (discardingOversizedRecord) {
        const boundary = chunk.lastIndexOf(0x0a);
        if (boundary < 0) continue;
        chunk = chunk.subarray(0, boundary);
        discardingOversizedRecord = false;
      }
      const combined = carry.length ? Buffer.concat([chunk, carry]) : chunk;
      let lineEnd = combined.length;
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        let line = combined.subarray(index + 1, lineEnd);
        if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
        if (line.length > MAX_RECORD_BYTES) stats.oversizedRecords += 1;
        else if (line.length) yield line;
        lineEnd = index;
      }
      carry = Buffer.from(combined.subarray(0, lineEnd));
      if (carry.length > MAX_RECORD_BYTES) {
        stats.oversizedRecords += 1;
        carry = Buffer.alloc(0);
        discardingOversizedRecord = true;
      }
    }
    if (!discardingOversizedRecord && carry.length) yield carry;
  } finally {
    await handle.close();
  }
}

function toUsage(value: z.infer<typeof rolloutTokenUsageSchema>): CodexUsageBreakdown {
  return {
    inputTokens: value.input_tokens,
    cachedInputTokens: value.cached_input_tokens,
    cacheWriteInputTokens: value.cache_write_input_tokens,
    outputTokens: value.output_tokens,
    reasoningOutputTokens: value.reasoning_output_tokens,
    totalTokens: value.total_tokens,
  };
}

function emptyUsage(): CodexUsageBreakdown {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function cumulativeUsageDelta(
  previous: CodexUsageBreakdown,
  current: CodexUsageBreakdown,
  lastUsage: CodexUsageBreakdown,
) {
  // After a counter restart the cumulative usage is the single latest request,
  // even when that request is larger than the preceding counter's total.
  if (current.totalTokens === lastUsage.totalTokens && current.totalTokens !== previous.totalTokens) return null;
  if (
    current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.cacheWriteInputTokens < previous.cacheWriteInputTokens ||
    current.outputTokens < previous.outputTokens ||
    current.reasoningOutputTokens < previous.reasoningOutputTokens ||
    current.totalTokens < previous.totalTokens
  ) {
    return null;
  }
  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    cacheWriteInputTokens: current.cacheWriteInputTokens - previous.cacheWriteInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningOutputTokens: current.reasoningOutputTokens - previous.reasoningOutputTokens,
    totalTokens: current.totalTokens - previous.totalTokens,
  } satisfies CodexUsageBreakdown;
}

function eventFingerprint(event: Omit<CodexUsageInternalEvent, 'eventFingerprint'>) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        1,
        event.model,
        event.serviceTier,
        event.quotaKind,
        event.limitId,
        event.planType,
        event.usedPercent,
        event.windowDurationMins,
        event.resetsAt,
        event.secondaryUsedPercent,
        event.secondaryWindowDurationMins,
        event.secondaryResetsAt,
        event.usage.inputTokens,
        event.usage.cachedInputTokens,
        event.usage.cacheWriteInputTokens,
        event.usage.outputTokens,
        event.usage.reasoningOutputTokens,
        event.usage.totalTokens,
      ]),
      'utf8',
    )
    .digest('hex');
}

function normalizeSessionUsage(
  candidates: readonly SessionUsageCandidate[],
  inheritedBeforeReverseOrder: number | null,
): CodexUsageInternalEvent[] {
  const turnServiceTiers = observedTurnServiceTiers(candidates.map(({ event }) => event));
  const chronological = [...candidates].sort(
    (left, right) =>
      left.event.timestamp.localeCompare(right.event.timestamp) || right.reverseOrder - left.reverseOrder,
  );
  let previousCumulative: CodexUsageBreakdown | null = null;
  return chronological.flatMap((candidate) => {
    let usage = candidate.event.usage;
    if (candidate.cumulativeUsage) {
      if (previousCumulative) {
        usage = cumulativeUsageDelta(previousCumulative, candidate.cumulativeUsage, usage) ?? usage;
      }
      previousCumulative = candidate.cumulativeUsage;
    } else {
      previousCumulative = null;
    }
    // Replayed history is still needed as the counter baseline for the first owned request.
    // Only the lineage-proven, context-free prefix is excluded from the reported usage.
    if (
      inheritedBeforeReverseOrder !== null &&
      candidate.reverseOrder >= inheritedBeforeReverseOrder &&
      candidate.event.turnId === null &&
      candidate.event.serviceTier === 'UNKNOWN'
    ) {
      return [];
    }
    const recoveredTier = candidate.event.turnId ? turnServiceTiers.get(candidate.event.turnId) : undefined;
    const recover = candidate.event.serviceTier === 'UNKNOWN' && recoveredTier && recoveredTier !== 'UNKNOWN';
    const event = {
      ...candidate.event,
      ...(recover ? { serviceTier: recoveredTier, serviceTierInferred: true } : {}),
      usage: { ...usage },
    };
    return [{ ...event, eventFingerprint: eventFingerprint(event) }];
  });
}

function observedTurnServiceTiers(
  events: readonly Pick<CodexUsageInternalEvent, 'turnId' | 'serviceTier' | 'serviceTierInferred'>[],
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

function normalizeChatTurns(
  sessionId: string,
  turns: ReadonlyMap<string, MutableChatTurn>,
  observedServiceTiers: ReadonlyMap<string, CodexUsageServiceTier>,
) {
  return [...turns.values()]
    .filter((turn): turn is MutableChatTurn & { startedAt: string } => turn.startedAt !== null)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.turnId.localeCompare(right.turnId))
    .map((turn, turnOrder): CodexUsageInternalChatTurn => ({
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

function appendPendingEvents(
  events: SessionUsageCandidate[],
  sessionId: string,
  model: string,
  turnId: string | null,
  serviceTier: CodexUsageServiceTier,
  serviceTierInferred: boolean,
  pending: readonly PendingUsage[],
) {
  for (const pendingEvent of pending) {
    events.push({
      event: {
        sessionId,
        turnId,
        timestamp: pendingEvent.timestamp,
        model,
        serviceTier,
        serviceTierInferred,
        quotaKind: pendingEvent.quotaKind,
        limitId: pendingEvent.limitId,
        planType: pendingEvent.planType,
        usedPercent: pendingEvent.usedPercent,
        windowDurationMins: pendingEvent.windowDurationMins,
        resetsAt: pendingEvent.resetsAt,
        secondaryUsedPercent: pendingEvent.secondaryUsedPercent,
        secondaryWindowDurationMins: pendingEvent.secondaryWindowDurationMins,
        secondaryResetsAt: pendingEvent.secondaryResetsAt,
        usage: { ...pendingEvent.usage },
      },
      cumulativeUsage: pendingEvent.cumulativeUsage,
      reverseOrder: pendingEvent.reverseOrder,
    });
  }
}

function serviceTier(value: string | null | undefined): CodexUsageServiceTier {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'default' || normalized === 'standard') return 'STANDARD';
  if (normalized === 'priority' || normalized === 'fast') return 'FAST';
  return 'UNKNOWN';
}

function quotaKind(limitId: string | null | undefined, limitName: string | null | undefined): CodexUsageQuotaKind {
  const normalizedId = limitId?.trim().toLowerCase();
  const normalizedName = limitName?.trim().toLowerCase();
  if (normalizedId === 'codex') return 'MAIN';
  if (normalizedId === 'codex_bengalfox' || normalizedName?.includes('spark')) return 'SEPARATE';
  return 'UNKNOWN';
}

function parsedTimestamp(timestamp: string) {
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch)) return null;
  return { epoch, iso: new Date(epoch).toISOString() };
}

function recognizedRecordEnvelope(line: Buffer) {
  const prefix = line.subarray(0, Math.min(line.length, MAX_ENVELOPE_PREFIX_BYTES)).toString('utf8');
  const types = [...prefix.matchAll(/"type"\s*:\s*"([a-z_]+)"/g)].map((match) => match[1]);
  if (types[0] === 'turn_context' || types[0] === 'compacted' || types[0] === 'session_meta') return true;
  return (
    types[0] === 'event_msg' &&
    ['token_count', 'thread_settings_applied', 'task_started', 'task_complete', 'turn_aborted'].includes(types[1] ?? '')
  );
}

function isBelowRange(timestampEpoch: number, fromEpoch: number | null) {
  return fromEpoch !== null && timestampEpoch < fromEpoch;
}

function hasRecognizedRecordMarker(line: Buffer) {
  return (
    line.includes(TOKEN_COUNT_MARKER) ||
    line.includes(TURN_CONTEXT_MARKER) ||
    line.includes(THREAD_SETTINGS_MARKER) ||
    line.includes(TASK_STARTED_MARKER) ||
    line.includes(TASK_COMPLETE_MARKER) ||
    line.includes(TURN_ABORTED_MARKER) ||
    line.includes(COMPACTED_MARKER) ||
    line.includes(SESSION_META_MARKER)
  );
}

function parsedSettings(value: unknown): ParsedSessionLine {
  const settingsRow = threadSettingsRowSchema.safeParse(value);
  if (!settingsRow.success) return { kind: 'INVALID' };
  const settings = settingsRow.data.payload.thread_settings;
  // A complete ThreadSettingsSnapshot omits service_tier when no tier is requested.
  // Sparse/legacy records without the snapshot's model/provider identity remain unknown.
  const defaultTier = settings.service_tier == null && Boolean(settings.model && settings.model_provider_id);
  return {
    kind: 'SETTINGS',
    model: settings.model ?? null,
    serviceTier: defaultTier ? 'STANDARD' : serviceTier(settings.service_tier),
    serviceTierInferred: defaultTier,
  };
}

function parseSessionLine(line: Buffer): ParsedSessionLine {
  if (!hasRecognizedRecordMarker(line)) return { kind: 'IGNORED' };
  if (!recognizedRecordEnvelope(line)) return { kind: 'IGNORED' };
  let value: unknown;
  try {
    value = JSON.parse(line.toString('utf8')) as unknown;
  } catch {
    return { kind: 'INVALID' };
  }
  const envelope = rowEnvelopeSchema.safeParse(value);
  if (!envelope.success) return { kind: 'IGNORED' };
  if (envelope.data.type === 'session_meta') {
    return parseSessionLineage(envelope.data.payload);
  }
  if (envelope.data.type === 'compacted') {
    const compactedRow = compactedRowSchema.safeParse(value);
    if (!compactedRow.success) return { kind: 'INVALID' };
    const timestamp = parsedTimestamp(compactedRow.data.timestamp);
    return timestamp ? { kind: 'COMPACTION', timestamp } : { kind: 'INVALID' };
  }
  if (envelope.data.type === 'turn_context') {
    const contextRow = turnContextRowSchema.safeParse(value);
    return contextRow.success
      ? {
          kind: 'CONTEXT',
          model: contextRow.data.payload.model,
          reasoningEffort: contextRow.data.payload.effort?.trim().toLowerCase() ?? null,
          turnId: contextRow.data.payload.turn_id,
        }
      : { kind: 'INVALID' };
  }
  if (envelope.data.type !== 'event_msg') return { kind: 'IGNORED' };
  const eventType = envelope.data.payload?.type;
  if (eventType === 'token_count') {
    const tokenRow = tokenCountRowSchema.safeParse(value);
    if (!tokenRow.success) return { kind: 'INVALID' };
    const timestamp = parsedTimestamp(tokenRow.data.timestamp);
    return timestamp ? { kind: 'TOKEN', row: tokenRow.data, timestamp } : { kind: 'INVALID' };
  }
  if (eventType === 'task_started') {
    const startedRow = taskStartedRowSchema.safeParse(value);
    if (!startedRow.success) return { kind: 'INVALID' };
    const timestamp = parsedTimestamp(startedRow.data.timestamp);
    return timestamp
      ? { kind: 'TURN_STARTED', turnId: startedRow.data.payload.turn_id, timestamp: timestamp.iso }
      : { kind: 'INVALID' };
  }
  if (eventType === 'task_complete' || eventType === 'turn_aborted') {
    const terminalRow = taskTerminalRowSchema.safeParse(value);
    if (!terminalRow.success) return { kind: 'INVALID' };
    const timestamp = parsedTimestamp(terminalRow.data.timestamp);
    return timestamp
      ? {
          kind: 'TURN_TERMINAL',
          turnId: terminalRow.data.payload.turn_id,
          timestamp: timestamp.iso,
          terminalState: terminalRow.data.payload.type === 'task_complete' ? 'COMPLETED' : 'ABORTED',
          durationMs:
            terminalRow.data.payload.type === 'task_complete' ? (terminalRow.data.payload.duration_ms ?? null) : null,
        }
      : { kind: 'INVALID' };
  }
  if (eventType !== 'thread_settings_applied') return { kind: 'IGNORED' };
  return parsedSettings(value);
}

function pendingUsageFromToken(parsed: ParsedTokenLine, reverseOrder: number): PendingUsage | null {
  const usage = parsed.row.payload.info?.last_token_usage;
  const cumulativeUsage = parsed.row.payload.info?.total_token_usage;
  const rateLimits = parsed.row.payload.rate_limits;
  if (![usage, cumulativeUsage, rateLimits].some(Boolean)) return null;
  return {
    timestamp: parsed.timestamp.iso,
    usage: usage ? toUsage(usage) : emptyUsage(),
    cumulativeUsage: cumulativeUsage ? toUsage(cumulativeUsage) : null,
    reverseOrder,
    quotaKind: quotaKind(rateLimits?.limit_id, rateLimits?.limit_name),
    limitId: rateLimits?.limit_id ?? null,
    planType: rateLimits?.plan_type ?? null,
    usedPercent: rateLimits?.primary?.used_percent ?? null,
    windowDurationMins: rateLimits?.primary?.window_minutes ?? null,
    resetsAt: rateLimits?.primary?.resets_at ?? null,
    secondaryUsedPercent: rateLimits?.secondary?.used_percent ?? null,
    secondaryWindowDurationMins: rateLimits?.secondary?.window_minutes ?? null,
    secondaryResetsAt: rateLimits?.secondary?.resets_at ?? null,
  };
}

function collectTokenUsage(
  parsed: ParsedTokenLine,
  fromEpoch: number | null,
  toEpoch: number,
  pending: PendingUsage[],
  groupedEventCount: number,
  reverseOrder: number,
): TokenCollectionStatus {
  if (isBelowRange(parsed.timestamp.epoch, fromEpoch)) return 'BELOW_RANGE';
  if (parsed.timestamp.epoch > toEpoch) return 'IGNORED';
  const usage = pendingUsageFromToken(parsed, reverseOrder);
  if (!usage) return 'IGNORED';
  pending.push(usage);
  return pending.length + groupedEventCount >= MAX_PENDING_USAGE_EVENTS ? 'OVERFLOW' : 'ADDED';
}

export async function readCodexUsageSession(
  filePath: string,
  sessionId: string,
  threadCreatedMs: number,
  fallbackModel: string | null,
  fromEpoch: number | null,
  toEpoch: number,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
  signal?: AbortSignal,
  onBytesRead?: (bytes: number) => void,
): Promise<SessionReadResult> {
  const reverseStats: ReverseReadStats = { bytesRead: 0, oversizedRecords: 0 };
  const candidates: SessionUsageCandidate[] = [];
  const pending: PendingUsage[] = [];
  const pendingTierGroups: PendingUsageGroup[] = [];
  const chatTurns = new Map<string, MutableChatTurn>();
  let groupedEventCount = 0;
  let invalidRecords = 0;
  let contextCompactionCount = 0;
  let turnMetadataComplete = true;
  let crossedLowerBound = false;
  let reverseOrder = 0;
  const lineage = new CodexSessionLineage(sessionId, threadCreatedMs);

  const mutableChatTurn = (turnId: string) => {
    const existing = chatTurns.get(turnId);
    if (existing) return existing;
    if (chatTurns.size >= MAX_CHAT_TURNS) {
      invalidRecords += 1;
      turnMetadataComplete = false;
      return null;
    }
    const turn: MutableChatTurn = {
      turnId,
      startedAt: null,
      terminalAt: null,
      terminalState: null,
      durationMs: null,
      models: new Set(),
      reasoningEfforts: new Set(),
    };
    chatTurns.set(turnId, turn);
    return turn;
  };

  const groupPending = (model: string, turnId: string | null) => {
    if (!pending.length) return;
    const events = pending.splice(0);
    pendingTierGroups.push({ model, turnId, events });
    groupedEventCount += events.length;
  };

  const flushPendingTierGroups = (
    tier: CodexUsageServiceTier,
    inferMissing = false,
    tierInferred = false,
    contextDefault: Exclude<CodexUsageServiceTier, 'UNKNOWN'> | null = null,
  ) => {
    for (const group of pendingTierGroups) {
      if (!inferMissing) {
        appendPendingEvents(candidates, sessionId, group.model, group.turnId, tier, tierInferred, group.events);
        continue;
      }
      for (const event of group.events) {
        const configuredTier = inferredServiceTier(event.timestamp, serviceTierFallback);
        const contextDefaultApplies = configuredTier === null && group.turnId !== null && contextDefault !== null;
        appendPendingEvents(
          candidates,
          sessionId,
          group.model,
          group.turnId,
          configuredTier ?? (contextDefaultApplies ? contextDefault : tier),
          configuredTier !== null || contextDefaultApplies,
          [event],
        );
      }
    }
    pendingTierGroups.length = 0;
    groupedEventCount = 0;
  };

  for await (const line of reverseJsonLines(filePath, reverseStats, signal, onBytesRead)) {
    throwIfAborted(signal);
    const parsed = parseSessionLine(line);
    if (parsed.kind === 'IGNORED') continue;
    if (parsed.kind === 'LINEAGE') {
      lineage.addMetadata(parsed);
      continue;
    }
    if (parsed.kind === 'INVALID') {
      invalidRecords += 1;
      turnMetadataComplete = false;
      continue;
    }
    if (parsed.kind === 'COMPACTION') {
      if (threadCreatedMs === 0 || parsed.timestamp.epoch >= threadCreatedMs) {
        contextCompactionCount = Math.min(Number.MAX_SAFE_INTEGER, contextCompactionCount + 1);
      }
    } else if (parsed.kind === 'TOKEN') {
      const status = collectTokenUsage(parsed, fromEpoch, toEpoch, pending, groupedEventCount, reverseOrder);
      reverseOrder += 1;
      if (status === 'BELOW_RANGE') crossedLowerBound = true;
      else if (status === 'OVERFLOW') {
        groupPending(fallbackModel || 'unknown', null);
        flushPendingTierGroups('UNKNOWN', true);
        invalidRecords += 1;
        turnMetadataComplete = false;
      }
    } else if (parsed.kind === 'CONTEXT') {
      groupPending(parsed.model, parsed.turnId);
      const turn = mutableChatTurn(parsed.turnId);
      turn?.models.add(parsed.model);
      if (parsed.reasoningEffort) turn?.reasoningEfforts.add(parsed.reasoningEffort);
    } else if (parsed.kind === 'SETTINGS') {
      groupPending(parsed.model || fallbackModel || 'unknown', null);
      flushPendingTierGroups(parsed.serviceTier, false, parsed.serviceTierInferred);
    } else {
      lineage.addTurn(parsed, reverseOrder);
      const turn = mutableChatTurn(parsed.turnId);
      if (!turn) continue;
      applyChatTurnTiming(turn, parsed);
    }
    if (crossedLowerBound && pending.length === 0 && pendingTierGroups.length === 0) break;
  }
  groupPending(fallbackModel || 'unknown', null);
  // A turn context without an earlier settings event uses Codex's default Standard tier.
  // Keep context-free usage unknown because it cannot be tied to a complete turn configuration.
  flushPendingTierGroups('UNKNOWN', true, false, 'STANDARD');
  const normalizedEvents = normalizeSessionUsage(candidates, lineage.inheritedBeforeReverseOrder);
  const normalizedTurns = normalizeChatTurns(sessionId, chatTurns, observedTurnServiceTiers(normalizedEvents));
  const knownTurnIds = new Set(normalizedTurns.map(({ turnId }) => turnId));
  if (
    normalizedTurns.length !== chatTurns.size ||
    normalizedEvents.some(({ turnId, usage }) => usage.totalTokens > 0 && (!turnId || !knownTurnIds.has(turnId)))
  ) {
    turnMetadataComplete = false;
  }
  return {
    events: normalizedEvents,
    chatTurns: normalizedTurns,
    contextCompactionCount,
    turnMetadataComplete,
    invalidRecords,
    oversizedRecords: reverseStats.oversizedRecords,
    bytesRead: reverseStats.bytesRead,
  };
}
