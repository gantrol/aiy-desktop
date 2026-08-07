import { z } from 'zod';
import { DeepSeekProtocolError } from '@/main/assistant-models/deepseek-response';

const promptEditSchema = z
  .object({
    summary: z.string().max(4_000),
    preserved: z.array(z.string().max(2_000)).max(8),
    changes: z
      .array(
        z
          .object({
            before: z.string().max(10_000),
            after: z.string().max(10_000),
            reason: z.string().max(2_000),
          })
          .strict(),
      )
      .max(8),
    removed: z.array(z.string().max(2_000)).max(8),
    revisedUserInstruction: z.string().max(30_000),
  })
  .strict();

const assumptionSchema = z
  .object({
    label: z.string().max(500),
    interpretation: z.string().max(2_000),
    impact: z.string().max(2_000),
  })
  .strict();

const directionSchema = z
  .object({
    label: z.string().trim().min(1).max(500),
    prompt: z.string().trim().min(1).max(30_000),
    rationale: z.string().trim().min(1).max(4_000),
    variableAxis: z.string().trim().min(1).max(2_000),
    risk: z.string().trim().min(1).max(2_000),
  })
  .strict();

const promptDraftNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z
    .object({
      kind: z.literal('TERM'),
      termId: z.string().min(1).max(200),
      termRevisionId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal('RECIPE'),
      paletteId: z.string().min(1).max(200),
      paletteRevisionId: z.string().min(1).max(200),
    })
    .strict(),
]);

const promptDraftSchema = z
  .object({
    summary: z.string().max(2_000),
    warnings: z.array(z.string().max(500)).max(8),
    contentNodes: z.array(promptDraftNodeSchema).min(1).max(100),
  })
  .strict();

const sharedFields = {
  assistantMessage: z.string().max(20_000),
  sharedConstraints: z.array(z.string().max(2_000)).max(8),
  assumptions: z.array(assumptionSchema).max(4),
  directions: z.array(directionSchema).max(4),
};

const directionsOutputSchema = z
  .object({
    ...sharedFields,
    optimizedPrompt: z.string().max(30_000),
    promptEdit: promptEditSchema,
  })
  .strict();

const optimizationOutputSchema = z
  .object({
    ...sharedFields,
    promptDraft: promptDraftSchema,
  })
  .strict();

const titleOutputSchema = z.object({ title: z.string().max(300) }).strict();

function parseJson(value: string, label: string): unknown {
  let normalized = value.trim();
  if (normalized.startsWith('```')) {
    normalized = normalized.slice(3);
    if (normalized.slice(0, 4).toLocaleLowerCase() === 'json') normalized = normalized.slice(4);
    normalized = normalized.trimStart();
  }
  if (normalized.endsWith('```')) normalized = normalized.slice(0, -3).trimEnd();
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new DeepSeekProtocolError(`DeepSeek returned invalid ${label} JSON`, error);
  }
}

function issueSummary(error: z.ZodError) {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '$'}: ${issue.message}`)
    .join('; ')
    .slice(0, 800);
}

function decode<T>(schema: z.ZodType<T>, value: string, label: string): T {
  const decoded = schema.safeParse(parseJson(value, label));
  if (!decoded.success) {
    throw new DeepSeekProtocolError(`DeepSeek returned an invalid ${label}: ${issueSummary(decoded.error)}`);
  }
  return decoded.data;
}

export function decodeDeepSeekDirectionsOutput(value: string) {
  return decode(directionsOutputSchema, value, 'directions result');
}

export function decodeDeepSeekOptimizationOutput(value: string) {
  return decode(optimizationOutputSchema, value, 'optimization result');
}

export function decodeDeepSeekTitleOutput(value: string) {
  return decode(titleOutputSchema, value, 'title result');
}
