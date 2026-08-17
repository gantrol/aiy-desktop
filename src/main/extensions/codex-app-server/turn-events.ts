import { z } from 'zod';
import {
  threadTokenUsageUpdatedNotificationSchema,
  type CodexAppServerTokenUsage,
} from '@/main/extensions/codex-app-server/protocol';

type JsonObject = Record<string, unknown>;

const turnMessageSchema = z
  .object({
    method: z.string().max(1_000).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const jsonObjectSchema = z.record(z.string(), z.unknown());
const headerSchema = z.string();
const tokenCountSchema = z.number().int().nonnegative().safe();

export type CodexRpcTurnMessage = z.input<typeof turnMessageSchema>;

export interface CodexAppServerTurnEvent {
  method: string;
  itemId?: string;
  itemType?: string;
  itemStatus?: string;
  toolKind?: string;
  toolName?: string;
  usage?: Partial<CodexAppServerTokenUsage>;
  degradationReason?: string;
  droppedEventCount?: number;
  droppedEventCountExact?: boolean;
}

function jsonObject(value: unknown): JsonObject | undefined {
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function boundedHeader(value: unknown, maximum: number) {
  const parsed = headerSchema.safeParse(value);
  return parsed.success && parsed.data.trim() ? parsed.data.trim().slice(0, maximum) : undefined;
}

function tokenCount(source: JsonObject | undefined, keys: readonly string[]) {
  if (!source) return undefined;
  for (const key of keys) {
    const parsed = tokenCountSchema.safeParse(source[key]);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function normalizedUsage(message: CodexRpcTurnMessage, item: JsonObject | undefined, turn: JsonObject | undefined) {
  const parsedThreadUsage = threadTokenUsageUpdatedNotificationSchema.safeParse(message.params);
  if (message.method === 'thread/tokenUsage/updated' && parsedThreadUsage.success) {
    return { ...parsedThreadUsage.data.tokenUsage.total };
  }
  const params = jsonObject(message.params);
  const tokenUsage = jsonObject(params?.tokenUsage);
  const sources = [
    tokenUsage,
    jsonObject(params?.usage),
    jsonObject(tokenUsage?.total),
    jsonObject(turn?.tokenUsage),
    jsonObject(turn?.usage),
    jsonObject(item?.tokenUsage),
    jsonObject(item?.usage),
  ].filter((source): source is JsonObject => Boolean(source));
  for (const source of sources) {
    const usage = {
      inputTokens: tokenCount(source, ['inputTokens', 'input_tokens', 'inputTokenCount', 'input_token_count']),
      cachedInputTokens: tokenCount(source, [
        'cachedInputTokens',
        'cached_input_tokens',
        'cachedInputTokenCount',
        'cached_input_token_count',
      ]),
      outputTokens: tokenCount(source, ['outputTokens', 'output_tokens', 'outputTokenCount', 'output_token_count']),
      reasoningOutputTokens: tokenCount(source, [
        'reasoningOutputTokens',
        'reasoning_output_tokens',
        'reasoningOutputTokenCount',
        'reasoning_output_token_count',
      ]),
      totalTokens: tokenCount(source, ['totalTokens', 'total_tokens', 'totalTokenCount', 'total_token_count']),
    };
    if (Object.values(usage).some((value) => value !== undefined)) return usage;
  }
  return undefined;
}

function normalizedStatus(method: string, item: JsonObject | undefined, turn: JsonObject | undefined) {
  const explicit = boundedHeader(item?.status, 100) ?? boundedHeader(turn?.status, 100);
  if (explicit) return explicit;
  if (method === 'item/started') return 'in_progress';
  if (method === 'item/completed') return 'completed';
  if (method === 'error') return 'failed';
  return undefined;
}

function normalizedTool(item: JsonObject | undefined, itemType: string | undefined) {
  const explicitKind = boundedHeader(item?.toolKind, 100);
  const inferredKind = itemType && /(tool|command|fileChange|webSearch|imageGeneration)/i.test(itemType);
  const toolKind = explicitKind ?? (inferredKind ? itemType : undefined);
  const toolName =
    boundedHeader(item?.toolName, 200) ??
    boundedHeader(item?.tool, 200) ??
    (toolKind ? boundedHeader(item?.name, 200) : undefined);
  return { toolKind, toolName };
}

export function normalizedTurnEvent(message: unknown): CodexAppServerTurnEvent {
  const parsed = turnMessageSchema.safeParse(message);
  if (!parsed.success) return { method: 'unknown' };
  const method = boundedHeader(parsed.data.method, 200) ?? 'unknown';
  const item = jsonObject(parsed.data.params?.item);
  const turn = jsonObject(parsed.data.params?.turn);
  const itemType = boundedHeader(item?.type, 100) ?? (turn ? 'turn' : undefined);
  const itemStatus = normalizedStatus(method, item, turn);
  const { toolKind, toolName } = normalizedTool(item, itemType);
  const usage = normalizedUsage(parsed.data, item, turn);
  const event: CodexAppServerTurnEvent = {
    method,
    itemId: boundedHeader(item?.id, 512) ?? boundedHeader(turn?.id, 512),
  };
  if (itemType) event.itemType = itemType;
  if (itemStatus) event.itemStatus = itemStatus;
  if (toolKind) event.toolKind = toolKind;
  if (toolName) event.toolName = toolName;
  if (usage) event.usage = usage;
  return event;
}

export function isCriticalEarlyTurnMessage(message: unknown) {
  const parsed = turnMessageSchema.safeParse(message);
  if (!parsed.success) return false;
  if (parsed.data.method === 'turn/completed') return true;
  if (parsed.data.method !== 'item/completed') return false;
  const item = jsonObject(parsed.data.params?.item);
  return (
    item?.type === 'imageGeneration' ||
    (item?.type === 'agentMessage' && (item?.phase === 'final_answer' || item?.phase === undefined))
  );
}
