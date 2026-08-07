import type { z } from 'zod';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';
import { decodeProviderResponseJson, ProviderResponseError } from '@/main/provider-response';

export async function decodeGenerationProviderResponseJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  provider: string,
): Promise<T> {
  try {
    return await decodeProviderResponseJson(response, schema, { provider });
  } catch (error) {
    if (error instanceof ProviderResponseError) {
      throw new GenerationAdapterError({
        code: 'PROVIDER_PROTOCOL_ERROR',
        message: error.message,
        details: { reason: 'INVALID_PROVIDER_RESPONSE' },
        cause: error,
      });
    }
    throw error;
  }
}
