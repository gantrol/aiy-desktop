import { createHash } from 'node:crypto';
import type { CodexUsagePricingBasis, CodexUsageServiceTier } from '@/shared/contracts/codex-usage';
import { codexUsageSpeedCreditMultiplier } from '@/shared/codex-usage-speed';
import {
  CODEX_USAGE_RATE_CARD,
  codexUsageCatalogModel,
  codexUsageModelPrice,
  codexUsagePriceAt,
} from '@/shared/codex-usage-rate-card';

const TOKENS_PER_MILLION = 1_000_000;
export const CODEX_USAGE_LONG_CONTEXT_THRESHOLD = CODEX_USAGE_RATE_CARD.longContextThresholdTokens;
// Price-only edits invalidate derived statistics without re-reading unchanged rollout files.
export const CODEX_USAGE_PRICING_CACHE_KEY = createHash('sha256')
  .update(JSON.stringify(CODEX_USAGE_RATE_CARD))
  .digest('hex');

export const CODEX_USAGE_PRICING_BASIS: CodexUsagePricingBasis = {
  apiVerifiedAt: CODEX_USAGE_RATE_CARD.updatedAt,
  apiSourceUrl: CODEX_USAGE_RATE_CARD.apiSourceUrl,
  creditVerifiedAt: CODEX_USAGE_RATE_CARD.updatedAt,
  creditSourceUrl: CODEX_USAGE_RATE_CARD.creditSourceUrl,
  longContextThresholdTokens: CODEX_USAGE_LONG_CONTEXT_THRESHOLD,
};

export interface CodexUsageBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export function normalizeCodexUsageModel(model: string) {
  const value = model.trim().toLowerCase();
  const catalogModel = codexUsageCatalogModel(value);
  if (catalogModel) return catalogModel;
  // Retain historical aliases; new models use the catalog's exact aliases/snapshots above.
  if (/^gpt-6-astra(?:$|[-:])/.test(value)) return 'gpt-6-astra';
  if (/^gpt-5\.6-luna(?:$|[-:])/.test(value)) return 'gpt-5.6-luna';
  if (/^gpt-5\.6-terra(?:$|[-:])/.test(value)) return 'gpt-5.6-terra';
  if (/^gpt-5\.6-sol(?:$|[-:])/.test(value) || /^gpt-5\.6(?:$|-\d{4}-)/.test(value)) return 'gpt-5.6-sol';
  if (/^gpt-5\.5-pro(?:$|[-:])/.test(value)) return 'gpt-5.5-pro';
  if (/^gpt-5\.5(?:$|-\d{4}-)/.test(value)) return 'gpt-5.5';
  if (/^gpt-5\.4-mini(?:$|[-:])/.test(value)) return 'gpt-5.4-mini';
  if (/^gpt-5\.4-nano(?:$|[-:])/.test(value)) return 'gpt-5.4-nano';
  if (/^gpt-5\.4-pro(?:$|[-:])/.test(value)) return 'gpt-5.4-pro';
  if (/^gpt-5\.4(?:$|-\d{4}-)/.test(value)) return 'gpt-5.4';
  if (/^gpt-5\.3-codex(?:$|[-:])/.test(value)) return 'gpt-5.3-codex';
  if (/^gpt-5\.2-pro(?:$|[-:])/.test(value)) return 'gpt-5.2-pro';
  if (/^gpt-5\.2-codex(?:$|[-:])/.test(value)) return 'gpt-5.2';
  if (/^gpt-5\.2(?:$|-\d{4}-)/.test(value)) return 'gpt-5.2';
  if (/^gpt-5-codex(?:$|[-:])/.test(value)) return 'gpt-5-codex';
  if (/^daybreak-blue(?:$|[-:])/.test(value)) return 'daybreak-blue';
  if (/^(?:gpt-5\.6-cyber|daybreak-red)(?:$|[-:])/.test(value)) return 'daybreak-red';
  return value;
}

function boundedInputCategories(usage: CodexUsageBreakdown) {
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const cacheWriteInputTokens = Math.min(
    usage.cacheWriteInputTokens,
    Math.max(0, usage.inputTokens - cachedInputTokens),
  );
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens - cacheWriteInputTokens);
  return { uncachedInputTokens, cachedInputTokens, cacheWriteInputTokens };
}

export interface CodexUsagePriceEstimate {
  apiEquivalentUsd: number | null;
  apiCacheSavingsUsd: number | null;
  codexCredits: number | null;
  codexCreditCacheSavings: number | null;
  apiPricedTokens: number;
  creditPricedTokens: number;
  longContext: boolean;
}

export function estimateCodexUsage(
  model: string,
  usage: CodexUsageBreakdown,
  serviceTier: CodexUsageServiceTier,
  occurredAt: string,
): CodexUsagePriceEstimate {
  const key = normalizeCodexUsageModel(model);
  const modelPrice = codexUsageModelPrice(key);
  const apiPrice = codexUsagePriceAt(modelPrice?.api ?? [], occurredAt);
  const creditPrice = codexUsagePriceAt(modelPrice?.credits ?? [], occurredAt);
  const { uncachedInputTokens, cachedInputTokens, cacheWriteInputTokens } = boundedInputCategories(usage);
  const creditMultiplier = codexUsageSpeedCreditMultiplier(key, serviceTier);
  const longContext = Boolean(apiPrice?.longContext && usage.inputTokens > CODEX_USAGE_LONG_CONTEXT_THRESHOLD);
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const apiPriceComplete = Boolean(
    apiPrice &&
    (cachedInputTokens === 0 || apiPrice.cachedInputPerMillionUsd !== null) &&
    (cacheWriteInputTokens === 0 || apiPrice.cacheWriteInputPerMillionUsd !== null),
  );
  // Standard API-equivalent value, not the price of an API Fast request or a subscription invoice.
  const apiEquivalentUsd =
    apiPrice && apiPriceComplete
      ? (uncachedInputTokens * apiPrice.inputPerMillionUsd * inputMultiplier +
          cachedInputTokens * (apiPrice.cachedInputPerMillionUsd ?? 0) * inputMultiplier +
          cacheWriteInputTokens * (apiPrice.cacheWriteInputPerMillionUsd ?? 0) * inputMultiplier +
          usage.outputTokens * apiPrice.outputPerMillionUsd * outputMultiplier) /
        TOKENS_PER_MILLION
      : null;
  const apiCacheSavingsUsd =
    apiPrice && apiPrice.cachedInputPerMillionUsd !== null
      ? (cachedInputTokens * (apiPrice.inputPerMillionUsd - apiPrice.cachedInputPerMillionUsd) * inputMultiplier) /
        TOKENS_PER_MILLION
      : null;
  // The Codex credits rate card does not publish a separate cache-write category.
  const codexCredits =
    creditPrice && creditMultiplier !== null
      ? ((uncachedInputTokens * creditPrice.inputPerMillion +
          cachedInputTokens * creditPrice.cachedInputPerMillion +
          usage.outputTokens * creditPrice.outputPerMillion) /
          TOKENS_PER_MILLION) *
        creditMultiplier
      : null;
  const codexCreditCacheSavings =
    creditPrice && creditMultiplier !== null
      ? ((cachedInputTokens * (creditPrice.inputPerMillion - creditPrice.cachedInputPerMillion)) / TOKENS_PER_MILLION) *
        creditMultiplier
      : null;
  return {
    apiEquivalentUsd,
    apiCacheSavingsUsd,
    codexCredits,
    codexCreditCacheSavings,
    apiPricedTokens: apiEquivalentUsd === null ? 0 : usage.totalTokens,
    creditPricedTokens: codexCredits === null ? 0 : usage.totalTokens,
    longContext,
  };
}
