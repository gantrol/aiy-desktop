import { lstatSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { CodexAssistInput } from '@/shared/contracts';

const MAX_STRUCTURED_OUTPUT_BYTES = 4 * 1024 * 1024;
const boundedId = z.string().min(1).max(200);
const shortText = z.string().max(2_000);
const promptText = z.string().max(30_000);

const promptDraftNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: promptText }).strict(),
  z.object({ kind: z.literal('TERM'), termId: boundedId, termRevisionId: boundedId }).strict(),
  z.object({ kind: z.literal('RECIPE'), paletteId: boundedId, paletteRevisionId: boundedId }).strict(),
]);

const promptDraftSchema = z
  .object({
    summary: shortText,
    warnings: z.array(z.string().max(500)).max(8),
    contentNodes: z.array(promptDraftNodeSchema).min(1).max(100),
  })
  .strict();

const promptEditSchema = z
  .object({
    summary: shortText,
    preserved: z.array(z.string().max(2_000)).max(8),
    changes: z
      .array(
        z
          .object({
            before: promptText,
            after: promptText,
            reason: z.string().max(2_000),
          })
          .strict(),
      )
      .max(8),
    removed: z.array(z.string().max(2_000)).max(8),
    revisedUserInstruction: promptText,
  })
  .strict();

const assumptionsSchema = z
  .array(
    z
      .object({
        label: z.string().max(500),
        interpretation: shortText,
        impact: shortText,
      })
      .strict(),
  )
  .max(4);

const directionsSchema = z
  .array(
    z
      .object({
        label: z.string().trim().min(1).max(500),
        prompt: z.string().trim().min(1).max(30_000),
        rationale: z.string().trim().min(1).max(4_000),
        variableAxis: z.string().trim().min(1).max(1_000),
        risk: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  )
  .max(4);

const sharedAssistFields = {
  assistantMessage: z.string().max(10_000).optional(),
  sharedConstraints: z.array(z.string().max(2_000)).max(8).optional(),
  assumptions: assumptionsSchema.optional(),
  directions: directionsSchema.optional(),
};

const promptDraftAssistSchema = z
  .object({
    ...sharedAssistFields,
    promptDraft: promptDraftSchema,
  })
  .strict();

const standardAssistSchema = z
  .object({
    ...sharedAssistFields,
    optimizedPrompt: promptText.optional(),
    promptEdit: promptEditSchema.optional(),
  })
  .strict();

const titleOutputSchema = z.object({ title: z.string().max(300) }).strict();

export type CodexStructuredAssistResult =
  z.infer<typeof promptDraftAssistSchema> | z.infer<typeof standardAssistSchema>;
export type CodexStructuredTitleResult = z.infer<typeof titleOutputSchema>;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Codex returned malformed structured JSON');
  }
}

function structuredMessageJson(message: string) {
  if (Buffer.byteLength(message, 'utf8') > MAX_STRUCTURED_OUTPUT_BYTES) {
    throw new Error('Codex returned an oversized structured result');
  }
  const trimmed = message.trim();
  let json = trimmed;
  if (trimmed.length >= 6 && trimmed.startsWith('```') && trimmed.endsWith('```')) {
    json = trimmed.slice(3, -3);
    if (json.slice(0, 4).toLocaleLowerCase() === 'json') json = json.slice(4);
    json = json.trim();
  }
  if (!json) throw new Error('Codex returned no structured result');
  return parseJson(json);
}

function structuredFileJson(filePath: string) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > MAX_STRUCTURED_OUTPUT_BYTES) {
    throw new Error('Codex returned an invalid structured result file');
  }
  return parseJson(readFileSync(filePath, 'utf8'));
}

function decodeAssist(value: unknown, mode: CodexAssistInput['mode']) {
  const schema = mode === 'optimize' ? promptDraftAssistSchema : standardAssistSchema;
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Codex returned a structured result that does not match the requested task');
  return result.data;
}

function decodeTitle(value: unknown) {
  const result = titleOutputSchema.safeParse(value);
  if (!result.success) throw new Error('Codex returned an invalid title result');
  return result.data;
}

export function decodeCodexAssistOutputFile(filePath: string, mode: CodexAssistInput['mode']) {
  return decodeAssist(structuredFileJson(filePath), mode);
}

export function decodeCodexAssistOutputMessage(message: string, mode: CodexAssistInput['mode']) {
  return decodeAssist(structuredMessageJson(message), mode);
}

export function decodeCodexTitleOutputFile(filePath: string) {
  return decodeTitle(structuredFileJson(filePath));
}

export function decodeCodexTitleOutputMessage(message: string) {
  return decodeTitle(structuredMessageJson(message));
}
