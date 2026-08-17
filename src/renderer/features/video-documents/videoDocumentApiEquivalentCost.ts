import type { VideoDocumentGenerationRunDto } from '@/shared/contracts/video-document';

const TOKENS_PER_MILLION = 1_000_000;

interface StandardTokenPrice {
  modelId: string;
  verifiedAt: string;
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export const GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE: StandardTokenPrice = {
  modelId: 'gpt-5.6-luna',
  verifiedAt: '2026-08-12',
  inputPerMillionUsd: 0.2,
  cachedInputPerMillionUsd: 0.02,
  outputPerMillionUsd: 1.2,
};

function standardPrice(modelId: string): StandardTokenPrice | null {
  const normalized = modelId.trim().toLowerCase();
  return /^gpt-5\.6-luna(?:$|[-:])/.test(normalized) ? GPT_5_6_LUNA_STANDARD_SHORT_CONTEXT_PRICE : null;
}

export function videoDocumentApiEquivalentCostUsd(
  run: Pick<VideoDocumentGenerationRunDto, 'actualModel' | 'requestedModel' | 'usage'>,
) {
  const price = standardPrice(run.actualModel ?? run.requestedModel);
  const inputTokens = run.usage?.inputTokens;
  const outputTokens = run.usage?.outputTokens;
  if (
    !price ||
    inputTokens === null ||
    inputTokens === undefined ||
    outputTokens === null ||
    outputTokens === undefined
  ) {
    return null;
  }

  // Provider input totals include cached input; output totals already include reasoning tokens.
  const cachedInputTokens = Math.min(run.usage?.cachedInputTokens ?? 0, inputTokens);
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  return (
    (uncachedInputTokens * price.inputPerMillionUsd +
      cachedInputTokens * price.cachedInputPerMillionUsd +
      outputTokens * price.outputPerMillionUsd) /
    TOKENS_PER_MILLION
  );
}

export function formatApiEquivalentCostUsd(value: number) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}
