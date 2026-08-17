import { z } from 'zod';

export const DEFAULT_PROVIDER_JSON_BYTES = 96 * 1024 * 1024;
export const DEFAULT_PROVIDER_ERROR_BYTES = 1024 * 1024;

export class ProviderResponseError extends Error {
  readonly code = 'PROVIDER_PROTOCOL_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ProviderResponseError';
  }
}

function issueSummary(error: z.ZodError) {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '$'}: ${issue.message}`)
    .join('; ')
    .slice(0, 800);
}

async function responseTextWithinLimit(response: Response, provider: string, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProviderResponseError(`${provider} response exceeded the ${maxBytes}-byte limit`);
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
        throw new ProviderResponseError(`${provider} response exceeded the ${maxBytes}-byte limit`);
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function decodeProviderResponseJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  options: { provider: string; maxBytes?: number },
): Promise<T> {
  const serialized = await responseTextWithinLimit(
    response,
    options.provider,
    options.maxBytes ?? DEFAULT_PROVIDER_JSON_BYTES,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new ProviderResponseError(`${options.provider} returned invalid JSON`, error);
  }
  const decoded = schema.safeParse(parsed);
  if (!decoded.success) {
    throw new ProviderResponseError(`${options.provider} returned an invalid response: ${issueSummary(decoded.error)}`);
  }
  return decoded.data;
}

/** Error bodies are diagnostic-only. A malformed body returns null so callers
 * can report the stable HTTP status fallback; it must never enter a success path. */
export async function tryDecodeProviderErrorJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  provider: string,
): Promise<T | null> {
  try {
    return await decodeProviderResponseJson(response, schema, {
      provider,
      maxBytes: DEFAULT_PROVIDER_ERROR_BYTES,
    });
  } catch (error) {
    if (error instanceof ProviderResponseError) return null;
    throw error;
  }
}
