import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import type { CodexUsageQuotaKind, CodexUsageServiceTier } from '@/shared/contracts/codex-usage';
import type { CodexUsageBreakdown } from '@/main/extensions/codex-usage-investigator/pricing';

const READ_CHUNK_BYTES = 256 * 1024;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_USAGE_EVENTS = 10_000;
const TOKEN_COUNT_MARKER = Buffer.from('"token_count"');
const TURN_CONTEXT_MARKER = Buffer.from('"turn_context"');
const THREAD_SETTINGS_MARKER = Buffer.from('"thread_settings_applied"');

const safeTokenSchema = z.number().int().nonnegative().safe();
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
      })
      .passthrough(),
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
    quotaKind: z.enum(['MAIN', 'SEPARATE', 'UNKNOWN']).default('UNKNOWN'),
    firstAt: z.string().datetime(),
    lastAt: z.string().datetime(),
    requestCount: safeTokenSchema,
    usage: internalUsageSchema,
    apiEquivalentUsd: z.number().finite().nonnegative().nullable(),
    apiCacheSavingsUsd: z.number().finite().nonnegative().nullable(),
    codexCredits: z.number().finite().nonnegative().nullable(),
    apiPricedTokens: safeTokenSchema,
    creditPricedTokens: safeTokenSchema,
    longContextRequestCount: safeTokenSchema,
  })
  .strict();

export const codexUsageInternalEventSchema = z
  .object({
    sessionId: z.string().min(1).max(512),
    eventFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    timestamp: z.string().datetime(),
    model: z.string().min(1).max(200),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
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

export const codexUsageSessionReadResultSchema = z
  .object({
    events: z.array(codexUsageInternalEventSchema).max(100_000),
    invalidRecords: safeTokenSchema,
    oversizedRecords: safeTokenSchema,
    bytesRead: safeTokenSchema,
  })
  .strict();

export type CodexUsageInternalRow = z.infer<typeof codexUsageInternalRowSchema>;
export type CodexUsageInternalEvent = z.infer<typeof codexUsageInternalEventSchema>;
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
  events: PendingUsage[];
}

interface SessionUsageCandidate {
  event: Omit<CodexUsageInternalEvent, 'eventFingerprint'>;
  cumulativeUsage: CodexUsageBreakdown | null;
  reverseOrder: number;
}

type ParsedSessionLine =
  | { kind: 'IGNORED' }
  | { kind: 'INVALID' }
  | { kind: 'TOKEN'; row: z.infer<typeof tokenCountRowSchema>; timestamp: { epoch: number; iso: string } }
  | { kind: 'CONTEXT'; model: string }
  | { kind: 'SETTINGS'; model: string | null; serviceTier: CodexUsageServiceTier };

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

function cumulativeUsageDelta(previous: CodexUsageBreakdown, current: CodexUsageBreakdown) {
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

function normalizeSessionUsage(candidates: readonly SessionUsageCandidate[]): CodexUsageInternalEvent[] {
  const chronological = [...candidates].sort(
    (left, right) =>
      left.event.timestamp.localeCompare(right.event.timestamp) || right.reverseOrder - left.reverseOrder,
  );
  let previousCumulative: CodexUsageBreakdown | null = null;
  return chronological.map((candidate) => {
    let usage = candidate.event.usage;
    if (candidate.cumulativeUsage) {
      if (previousCumulative) {
        usage = cumulativeUsageDelta(previousCumulative, candidate.cumulativeUsage) ?? usage;
      }
      previousCumulative = candidate.cumulativeUsage;
    } else {
      previousCumulative = null;
    }
    const event = { ...candidate.event, usage: { ...usage } };
    return { ...event, eventFingerprint: eventFingerprint(event) };
  });
}

function appendPendingEvents(
  events: SessionUsageCandidate[],
  sessionId: string,
  model: string,
  serviceTier: CodexUsageServiceTier,
  pending: readonly PendingUsage[],
) {
  for (const pendingEvent of pending) {
    events.push({
      event: {
        sessionId,
        timestamp: pendingEvent.timestamp,
        model,
        serviceTier,
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

function isBelowRange(timestampEpoch: number, fromEpoch: number | null) {
  return fromEpoch !== null && timestampEpoch < fromEpoch;
}

function parseSessionLine(line: Buffer): ParsedSessionLine {
  if (
    !line.includes(TOKEN_COUNT_MARKER) &&
    !line.includes(TURN_CONTEXT_MARKER) &&
    !line.includes(THREAD_SETTINGS_MARKER)
  ) {
    return { kind: 'IGNORED' };
  }
  let value: unknown;
  try {
    value = JSON.parse(line.toString('utf8')) as unknown;
  } catch {
    return { kind: 'INVALID' };
  }
  const tokenRow = tokenCountRowSchema.safeParse(value);
  if (tokenRow.success) {
    const timestamp = parsedTimestamp(tokenRow.data.timestamp);
    return timestamp ? { kind: 'TOKEN', row: tokenRow.data, timestamp } : { kind: 'INVALID' };
  }
  const contextRow = turnContextRowSchema.safeParse(value);
  if (contextRow.success) return { kind: 'CONTEXT', model: contextRow.data.payload.model };
  const settingsRow = threadSettingsRowSchema.safeParse(value);
  if (!settingsRow.success) return { kind: 'INVALID' };
  return {
    kind: 'SETTINGS',
    model: settingsRow.data.payload.thread_settings.model ?? null,
    serviceTier: serviceTier(settingsRow.data.payload.thread_settings.service_tier),
  };
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
  fallbackModel: string | null,
  fromEpoch: number | null,
  toEpoch: number,
  signal?: AbortSignal,
  onBytesRead?: (bytes: number) => void,
): Promise<SessionReadResult> {
  const reverseStats: ReverseReadStats = { bytesRead: 0, oversizedRecords: 0 };
  const candidates: SessionUsageCandidate[] = [];
  const pending: PendingUsage[] = [];
  const pendingTierGroups: PendingUsageGroup[] = [];
  let groupedEventCount = 0;
  let invalidRecords = 0;
  let crossedLowerBound = false;
  let reverseOrder = 0;

  const groupPending = (model: string) => {
    if (!pending.length) return;
    const events = pending.splice(0);
    pendingTierGroups.push({ model, events });
    groupedEventCount += events.length;
  };

  const flushPendingTierGroups = (tier: CodexUsageServiceTier) => {
    for (const group of pendingTierGroups) {
      appendPendingEvents(candidates, sessionId, group.model, tier, group.events);
    }
    pendingTierGroups.length = 0;
    groupedEventCount = 0;
  };

  for await (const line of reverseJsonLines(filePath, reverseStats, signal, onBytesRead)) {
    throwIfAborted(signal);
    const parsed = parseSessionLine(line);
    if (parsed.kind === 'IGNORED') continue;
    if (parsed.kind === 'INVALID') {
      invalidRecords += 1;
      continue;
    }
    if (parsed.kind === 'TOKEN') {
      const status = collectTokenUsage(parsed, fromEpoch, toEpoch, pending, groupedEventCount, reverseOrder);
      reverseOrder += 1;
      if (status === 'BELOW_RANGE') crossedLowerBound = true;
      else if (status === 'OVERFLOW') {
        groupPending(fallbackModel || 'unknown');
        flushPendingTierGroups('UNKNOWN');
        invalidRecords += 1;
      }
    } else if (parsed.kind === 'CONTEXT') {
      groupPending(parsed.model);
    } else {
      groupPending(parsed.model || fallbackModel || 'unknown');
      flushPendingTierGroups(parsed.serviceTier);
    }
    if (crossedLowerBound && pending.length === 0 && pendingTierGroups.length === 0) break;
  }
  groupPending(fallbackModel || 'unknown');
  flushPendingTierGroups('UNKNOWN');
  return {
    events: normalizeSessionUsage(candidates),
    invalidRecords,
    oversizedRecords: reverseStats.oversizedRecords,
    bytesRead: reverseStats.bytesRead,
  };
}
