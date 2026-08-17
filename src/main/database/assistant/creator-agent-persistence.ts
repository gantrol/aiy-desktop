import { z } from 'zod';
import type { CodexAssistResult, CreatorAgentChatInput } from '@/shared/contracts';

export const MAX_CREATOR_AGENT_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_CREATOR_AGENT_RESULT_BYTES = 8 * 1024 * 1024;
export const MAX_CREATOR_AGENT_PAGE_BYTES = 16 * 1024 * 1024;

const identifier = z.string().min(1).max(200);

const storedRequestSchema = z.object({
  mode: z.literal('chat'),
  prompt: z.string().max(30_000),
  message: z.string().max(8_000).optional().default(''),
  attachmentAssetIds: z.array(identifier).max(8).optional().default([]),
});

const promptEditSchema = z
  .object({
    summary: z.string().max(8_000),
    preserved: z.array(z.string().max(8_000)).max(100),
    changes: z
      .array(
        z
          .object({
            before: z.string().max(30_000),
            after: z.string().max(30_000),
            reason: z.string().max(8_000),
          })
          .strict(),
      )
      .max(100),
    removed: z.array(z.string().max(8_000)).max(100),
    revisedUserInstruction: z.string().max(30_000),
  })
  .strict();

const promptDraftNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z
    .object({
      kind: z.literal('TERM'),
      termId: identifier,
      termRevisionId: identifier,
      displayName: z.string().max(300),
    })
    .strict(),
  z
    .object({
      kind: z.literal('RECIPE'),
      paletteId: identifier,
      paletteRevisionId: identifier,
      displayName: z.string().max(300),
      parameterValues: z.record(z.string().max(64), z.string().max(300)),
      promptLocale: z.enum(['zh', 'en']),
    })
    .strict(),
]);

const storedResultSchema = z
  .object({
    assistantMessage: z.string().max(100_000),
    optimizedPrompt: z.string().max(30_000).optional(),
    promptEdit: promptEditSchema.optional(),
    promptDraft: z
      .object({
        summary: z.string().max(8_000),
        warnings: z.array(z.string().max(8_000)).max(100),
        contentNodes: z.array(promptDraftNodeSchema).min(1).max(100),
      })
      .strict()
      .optional(),
    sharedConstraints: z.array(z.string().max(8_000)).max(100),
    assumptions: z
      .array(
        z
          .object({
            label: z.string().max(8_000),
            interpretation: z.string().max(8_000),
            impact: z.string().max(8_000),
          })
          .strict(),
      )
      .max(100),
    directions: z
      .array(
        z
          .object({
            label: z.string().max(8_000),
            prompt: z.string().max(30_000),
            rationale: z.string().max(8_000),
            variableAxis: z.string().max(8_000),
            risk: z.string().max(8_000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type StoredCreatorAgentRequest = z.infer<typeof storedRequestSchema>;

export class CreatorAgentPersistenceError extends Error {
  readonly code = 'CREATOR_AGENT_HISTORY_INVALID';

  constructor(
    readonly turnId: string,
    readonly reason: 'MALFORMED_REQUEST' | 'MALFORMED_RESULT' | 'OVERSIZED_REQUEST' | 'OVERSIZED_RESULT',
  ) {
    super(`Creator agent turn ${turnId} has invalid persisted data (${reason})`);
    this.name = 'CreatorAgentPersistenceError';
  }
}

function parseJson(value: string, turnId: string, kind: 'REQUEST' | 'RESULT') {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CreatorAgentPersistenceError(turnId, kind === 'REQUEST' ? 'MALFORMED_REQUEST' : 'MALFORMED_RESULT');
  }
}

export function decodeCreatorAgentRequest(value: string, turnId: string): StoredCreatorAgentRequest {
  const parsed = storedRequestSchema.safeParse(parseJson(value, turnId, 'REQUEST'));
  if (!parsed.success) throw new CreatorAgentPersistenceError(turnId, 'MALFORMED_REQUEST');
  return parsed.data;
}

export function decodeCreatorAgentResult(value: string, turnId: string): CodexAssistResult {
  const parsed = storedResultSchema.safeParse(parseJson(value, turnId, 'RESULT'));
  if (!parsed.success) throw new CreatorAgentPersistenceError(turnId, 'MALFORMED_RESULT');
  return parsed.data;
}

function encodedJson(value: unknown, turnId: string, kind: 'REQUEST' | 'RESULT') {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') {
    throw new CreatorAgentPersistenceError(turnId, kind === 'REQUEST' ? 'MALFORMED_REQUEST' : 'MALFORMED_RESULT');
  }
  const byteSize = Buffer.byteLength(json, 'utf8');
  const maximum = kind === 'REQUEST' ? MAX_CREATOR_AGENT_REQUEST_BYTES : MAX_CREATOR_AGENT_RESULT_BYTES;
  if (byteSize > maximum) {
    throw new CreatorAgentPersistenceError(turnId, kind === 'REQUEST' ? 'OVERSIZED_REQUEST' : 'OVERSIZED_RESULT');
  }
  return json;
}

export function encodeCreatorAgentRequest(input: CreatorAgentChatInput, turnId: string) {
  const parsed = storedRequestSchema.safeParse({
    mode: input.mode,
    prompt: input.prompt,
    message: input.message,
    attachmentAssetIds: input.attachmentAssetIds,
  });
  if (!parsed.success) throw new CreatorAgentPersistenceError(turnId, 'MALFORMED_REQUEST');
  return encodedJson(parsed.data, turnId, 'REQUEST');
}

export function encodeCreatorAgentResult(result: CodexAssistResult, turnId: string) {
  const parsed = storedResultSchema.safeParse(result);
  if (!parsed.success) throw new CreatorAgentPersistenceError(turnId, 'MALFORMED_RESULT');
  return encodedJson(parsed.data, turnId, 'RESULT');
}
