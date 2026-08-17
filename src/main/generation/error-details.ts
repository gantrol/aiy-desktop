import type { GenerationErrorDetailsDto } from '@/shared/contracts';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';

export function persistedGenerationErrorDetails(error: unknown): GenerationErrorDetailsDto | undefined {
  if (!(error instanceof GenerationAdapterError)) return undefined;
  let metadata: Record<string, unknown> = {};
  try {
    const serialized = JSON.stringify(error.details ?? {});
    if (serialized.length <= 32_000) {
      const parsed = JSON.parse(serialized) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } else {
      metadata = { detailsTruncated: true };
    }
  } catch {
    metadata = { detailsUnavailable: true };
  }
  return {
    retryable: error.retryable,
    providerCode: error.providerCode ?? null,
    metadata,
  };
}
