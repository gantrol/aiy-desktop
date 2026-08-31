import { z } from 'zod';
import {
  codexUsageInternalEventSchema,
  type CodexUsageInternalEvent,
} from '@/main/extensions/codex-usage-investigator/session-reader';
import type { CodexUsageThreadSource } from '@/main/extensions/codex-usage-investigator/thread-index';

export const CODEX_USAGE_EVENT_PAGE_SIZE = 2_000;

export interface CodexUsageFileFingerprint {
  sessionId: string;
  fallbackModel: string | null;
  threadSource: CodexUsageThreadSource;
  createdAtMs: number;
  size: number;
  mtimeMs: number;
  mtimeNs: string;
  ctimeNs: string;
}

export interface CodexUsageEventCoverage {
  storedFrom: string | null;
  storedTo: string | null;
  storedSessionCount: number;
  sourceEventCount: number;
}

export const storedEventRowSchema = z
  .object({
    sessionId: z.string(),
    eventOrder: z.number().int().nonnegative().safe(),
    eventFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    turnId: z.string().min(1).max(512).nullable(),
    timestampMs: z.number().int().nonnegative().safe(),
    timestamp: z.string(),
    model: z.string(),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
    serviceTierInferred: z.union([z.literal(0), z.literal(1)]),
    quotaKind: z.enum(['MAIN', 'SEPARATE', 'UNKNOWN']),
    limitId: z.string().nullable(),
    planType: z.string().nullable(),
    usedPercent: z.number().finite().nonnegative().nullable(),
    windowDurationMins: z.number().finite().nonnegative().nullable(),
    resetsAt: z.number().int().nonnegative().safe().nullable(),
    secondaryUsedPercent: z.number().finite().nonnegative().nullable(),
    secondaryWindowDurationMins: z.number().finite().nonnegative().nullable(),
    secondaryResetsAt: z.number().int().nonnegative().safe().nullable(),
    inputTokens: z.number().int().nonnegative().safe(),
    cachedInputTokens: z.number().int().nonnegative().safe(),
    cacheWriteInputTokens: z.number().int().nonnegative().safe(),
    outputTokens: z.number().int().nonnegative().safe(),
    reasoningOutputTokens: z.number().int().nonnegative().safe(),
    totalTokens: z.number().int().nonnegative().safe(),
  })
  .strict();

export type StoredEventRow = z.infer<typeof storedEventRowSchema>;

export const storedSessionSourceRowSchema = z
  .object({
    sessionId: z.string().min(1).max(512),
    threadSource: z.enum(['USER', 'SUBAGENT', 'OTHER']),
    invalidRecords: z.number().int().nonnegative().safe(),
    oversizedRecords: z.number().int().nonnegative().safe(),
    contextCompactionCount: z.number().int().nonnegative().safe(),
    turnMetadataComplete: z.union([z.literal(0), z.literal(1)]),
    hasUnassignedUsage: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

export const storedChatTurnRowSchema = z
  .object({
    sessionId: z.string().min(1).max(512),
    turnOrder: z.number().int().nonnegative().safe(),
    turnId: z.string().min(1).max(512),
    startedMs: z.number().int().nonnegative().safe(),
    startedAt: z.string().datetime(),
    terminalMs: z.number().int().nonnegative().safe().nullable(),
    terminalAt: z.string().datetime().nullable(),
    terminalState: z.enum(['COMPLETED', 'ABORTED']).nullable(),
    durationMs: z.number().int().nonnegative().safe().nullable(),
    model: z.string().min(1).max(200).nullable(),
    reasoningEffort: z.string().min(1).max(100).nullable(),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
    threadCreatedMs: z.number().int().nonnegative().safe(),
  })
  .strict();

export interface CodexUsageSessionSourceRecord {
  sessionId: string;
  threadSource: CodexUsageThreadSource;
  invalidRecords: number;
  oversizedRecords: number;
  contextCompactionCount: number;
  turnMetadataComplete: boolean;
  hasUnassignedUsage: boolean;
}

export type CodexUsageStoredChatTurn = z.infer<typeof storedChatTurnRowSchema>;

export function eventFromStoredRow(row: StoredEventRow): CodexUsageInternalEvent {
  return codexUsageInternalEventSchema.parse({
    sessionId: row.sessionId,
    eventFingerprint: row.eventFingerprint,
    turnId: row.turnId,
    timestamp: row.timestamp,
    model: row.model,
    serviceTier: row.serviceTier,
    serviceTierInferred: row.serviceTierInferred === 1,
    quotaKind: row.quotaKind,
    limitId: row.limitId,
    planType: row.planType,
    usedPercent: row.usedPercent,
    windowDurationMins: row.windowDurationMins,
    resetsAt: row.resetsAt,
    secondaryUsedPercent: row.secondaryUsedPercent,
    secondaryWindowDurationMins: row.secondaryWindowDurationMins,
    secondaryResetsAt: row.secondaryResetsAt,
    usage: {
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      cacheWriteInputTokens: row.cacheWriteInputTokens,
      outputTokens: row.outputTokens,
      reasoningOutputTokens: row.reasoningOutputTokens,
      totalTokens: row.totalTokens,
    },
  });
}
