import { z } from 'zod';

const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const deepSeekUsageSchema = z
  .object({
    input_tokens: z.number().finite().int().nonnegative(),
    output_tokens: z.number().finite().int().nonnegative(),
    total_tokens: z.number().finite().int().nonnegative(),
  })
  .passthrough();

const deepSeekOutputItemSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

const deepSeekCompletedResponseSchema = z
  .object({
    status: z.literal('completed'),
    model: z.string().min(1),
    output: z.array(deepSeekOutputItemSchema),
    usage: deepSeekUsageSchema.optional(),
  })
  .passthrough();

const deepSeekFailedResponseSchema = z
  .object({
    status: z.literal('failed'),
    error: z
      .object({
        message: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const deepSeekIncompleteResponseSchema = z
  .object({
    status: z.literal('incomplete'),
    incomplete_details: z
      .object({
        reason: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const deepSeekResponseSchema = z.discriminatedUnion('status', [
  deepSeekCompletedResponseSchema,
  deepSeekFailedResponseSchema,
  deepSeekIncompleteResponseSchema,
]);

const deepSeekMessageItemSchema = z
  .object({
    type: z.literal('message'),
    content: z.array(deepSeekOutputItemSchema),
  })
  .passthrough();

const deepSeekOutputTextSchema = z
  .object({
    type: z.literal('output_text'),
    text: z.string(),
  })
  .passthrough();

export type DeepSeekResponse = z.infer<typeof deepSeekResponseSchema>;
export type DeepSeekCompletedResponse = z.infer<typeof deepSeekCompletedResponseSchema>;

export class DeepSeekProtocolError extends Error {
  readonly code = 'PROVIDER_PROTOCOL_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DeepSeekProtocolError';
  }
}

function issueSummary(error: z.ZodError) {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '$'}: ${issue.message}`)
    .join('; ')
    .slice(0, 800);
}

export async function readDeepSeekResponseText(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new DeepSeekProtocolError(`DeepSeek response exceeded the ${maxBytes}-byte limit`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let value = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new DeepSeekProtocolError(`DeepSeek response exceeded the ${maxBytes}-byte limit`);
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function parseDeepSeekResponse(value: string): DeepSeekResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new DeepSeekProtocolError('DeepSeek returned invalid JSON', error);
  }

  const decoded = deepSeekResponseSchema.safeParse(parsed);
  if (!decoded.success) {
    throw new DeepSeekProtocolError(`DeepSeek returned an invalid response envelope: ${issueSummary(decoded.error)}`);
  }
  return decoded.data;
}

export function deepSeekResponseOutputText(body: DeepSeekCompletedResponse) {
  const textParts: string[] = [];
  for (const item of body.output) {
    if (item.type !== 'message') continue;
    const message = deepSeekMessageItemSchema.safeParse(item);
    if (!message.success) {
      throw new DeepSeekProtocolError(`DeepSeek returned an invalid message item: ${issueSummary(message.error)}`);
    }
    for (const part of message.data.content) {
      if (part.type !== 'output_text') continue;
      const outputText = deepSeekOutputTextSchema.safeParse(part);
      if (!outputText.success) {
        throw new DeepSeekProtocolError(
          `DeepSeek returned an invalid output_text item: ${issueSummary(outputText.error)}`,
        );
      }
      textParts.push(outputText.data.text);
    }
  }
  return textParts.join('\n').trim();
}

export function deepSeekWebSearchCallCount(body: DeepSeekCompletedResponse) {
  return body.output.filter((item) => item.type === 'web_search_call').length;
}
