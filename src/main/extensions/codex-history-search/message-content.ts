import { z } from 'zod';

export const MAX_CODEX_HISTORY_MESSAGE_TEXT_CHARACTERS = 1024 * 1024;

const MAX_SOURCE_MESSAGE_TEXT_CHARACTERS = 4 * 1024 * 1024;
const attachmentEnvelopeHeader = /^# Files (?:mentioned|pasted) by the user:[ \t]*\r?$/m;
const requestHeader = /^## My request:[ \t]*\r?$/m;

const userTextPartSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().max(MAX_SOURCE_MESSAGE_TEXT_CHARACTERS),
  })
  .passthrough();

const projectedUserMessageSchema = z
  .object({
    type: z.literal('userMessage'),
    id: z.string().min(1).max(512).optional(),
    content: z.array(z.unknown()).max(256),
  })
  .passthrough();

const projectedAgentMessageSchema = z
  .object({
    type: z.literal('agentMessage'),
    id: z.string().min(1).max(512).optional(),
    text: z.string().max(MAX_SOURCE_MESSAGE_TEXT_CHARACTERS),
    phase: z.string().max(64).nullable().optional(),
  })
  .passthrough();

export interface ParsedCodexHistoryMessage {
  messageId: string | null;
  role: 'USER' | 'ASSISTANT';
  text: string;
}

export function codexUserRequestText(value: string) {
  const trimmed = value.trim();
  const envelope = attachmentEnvelopeHeader.exec(trimmed);
  if (!envelope || envelope.index !== 0) return trimmed;
  const request = requestHeader.exec(trimmed);
  if (!request || request.index <= envelope.index) return trimmed;
  return trimmed.slice(request.index + request[0].length).trim();
}

export function parseProjectedCodexHistoryValue(
  itemType: 'userMessage' | 'agentMessage',
  value: unknown,
): ParsedCodexHistoryMessage | null {
  if (itemType === 'agentMessage') {
    const parsed = projectedAgentMessageSchema.safeParse(value);
    if (!parsed.success || (parsed.data.phase && parsed.data.phase !== 'final_answer')) return null;
    const text = parsed.data.text.trim().slice(0, MAX_CODEX_HISTORY_MESSAGE_TEXT_CHARACTERS);
    return text ? { messageId: parsed.data.id ?? null, role: 'ASSISTANT', text } : null;
  }

  const parsed = projectedUserMessageSchema.safeParse(value);
  if (!parsed.success) return null;
  const combined = parsed.data.content
    .flatMap((part) => {
      const candidate = userTextPartSchema.safeParse(part);
      return candidate.success ? [candidate.data.text] : [];
    })
    .join('\n');
  const text = codexUserRequestText(combined).slice(0, MAX_CODEX_HISTORY_MESSAGE_TEXT_CHARACTERS);
  return text ? { messageId: parsed.data.id ?? null, role: 'USER', text } : null;
}

export function parseProjectedCodexHistoryItem(itemType: 'userMessage' | 'agentMessage', itemJson: string) {
  let value: unknown;
  try {
    value = JSON.parse(itemJson);
  } catch {
    return null;
  }
  return parseProjectedCodexHistoryValue(itemType, value);
}
