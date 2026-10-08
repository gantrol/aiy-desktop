import { createHash } from 'node:crypto';
import type { CodexUsagePricingBasis, CodexUsageServiceTier } from '@/shared/contracts/codex-usage';
import { codexUsageSpeedCreditMultiplier } from '@/shared/codex-usage-speed';
import {
  CODEX_USAGE_RATE_CARD,
  codexUsageCatalogModel,
  codexUsageModelPrice,
  codexUsagePriceAt,
  type CodexUsageApiPricePeriod,
  type CodexUsageCreditPricePeriod,
} from '@/shared/codex-usage-rate-card';

const TOKENS_PER_MILLION = 1_000_000;
const PRICING_ALGORITHM_VERSION = 3;
export const CODEX_USAGE_LONG_CONTEXT_THRESHOLD = CODEX_USAGE_RATE_CARD.longContextThresholdTokens;
// Rates and calculation changes invalidate derived statistics while retaining imported usage events.
export const CODEX_USAGE_PRICING_CACHE_KEY = createHash('sha256')
  .update(JSON.stringify({ algorithmVersion: PRICING_ALGORITHM_VERSION, rateCard: CODEX_USAGE_RATE_CARD }))
  .digest('hex');

export const CODEX_USAGE_PRICING_BASIS: CodexUsagePricingBasis = {
  apiRateMode: 'RECORDED_SERVICE_TIER',
  apiVerifiedAt: CODEX_USAGE_RATE_CARD.updatedAt,
  apiSourceUrl: CODEX_USAGE_RATE_CARD.apiSourceUrl,
  creditVerifiedAt: CODEX_USAGE_RATE_CARD.creditUpdatedAt ?? CODEX_USAGE_RATE_CARD.updatedAt,
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

interface BillableInputTokens {
  apiUncachedInputTokens: number;
  creditUncachedInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
}

function billableInputTokens(usage: CodexUsageBreakdown): BillableInputTokens {
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const creditUncachedInputTokens = usage.inputTokens - cachedInputTokens;
  const cacheWriteInputTokens = Math.min(usage.cacheWriteInputTokens, creditUncachedInputTokens);
  // API prices cache writes separately; Credits include them at the regular input rate.
  const apiUncachedInputTokens = creditUncachedInputTokens - cacheWriteInputTokens;
  return { apiUncachedInputTokens, creditUncachedInputTokens, cachedInputTokens, cacheWriteInputTokens };
}

function tokenValue(tokenCount: number, ratePerMillion: number) {
  return (tokenCount * ratePerMillion) / TOKENS_PER_MILLION;
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

function estimateApiUsage(
  usage: CodexUsageBreakdown,
  input: BillableInputTokens,
  apiPrice: CodexUsageApiPricePeriod | null,
): Pick<CodexUsagePriceEstimate, 'apiEquivalentUsd' | 'apiCacheSavingsUsd' | 'longContext'> {
  const longContext = Boolean(apiPrice?.longContext && usage.inputTokens > CODEX_USAGE_LONG_CONTEXT_THRESHOLD);
  if (!apiPrice || (apiPrice.maxInputTokens !== undefined && usage.inputTokens > apiPrice.maxInputTokens)) {
    return { apiEquivalentUsd: null, apiCacheSavingsUsd: null, longContext };
  }

  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const apiCacheSavingsUsd =
    apiPrice.cachedInputPerMillionUsd !== null
      ? tokenValue(input.cachedInputTokens, apiPrice.inputPerMillionUsd - apiPrice.cachedInputPerMillionUsd) *
        inputMultiplier
      : null;

  const missingCacheReadPrice = input.cachedInputTokens > 0 && apiPrice.cachedInputPerMillionUsd === null;
  const missingCacheWritePrice = input.cacheWriteInputTokens > 0 && apiPrice.cacheWriteInputPerMillionUsd === null;
  if (missingCacheReadPrice || missingCacheWritePrice) {
    return { apiEquivalentUsd: null, apiCacheSavingsUsd, longContext };
  }

  const inputUsd = tokenValue(input.apiUncachedInputTokens, apiPrice.inputPerMillionUsd);
  const cacheReadUsd = tokenValue(input.cachedInputTokens, apiPrice.cachedInputPerMillionUsd ?? 0);
  const cacheWriteUsd = tokenValue(input.cacheWriteInputTokens, apiPrice.cacheWriteInputPerMillionUsd ?? 0);
  const outputUsd = tokenValue(usage.outputTokens, apiPrice.outputPerMillionUsd);
  const apiEquivalentUsd = (inputUsd + cacheReadUsd + cacheWriteUsd) * inputMultiplier + outputUsd * outputMultiplier;
  return { apiEquivalentUsd, apiCacheSavingsUsd, longContext };
}

function estimateCreditUsage(
  usage: CodexUsageBreakdown,
  input: BillableInputTokens,
  creditPrice: CodexUsageCreditPricePeriod | null,
  creditMultiplier: number | null,
): Pick<CodexUsagePriceEstimate, 'codexCredits' | 'codexCreditCacheSavings'> {
  if (!creditPrice || creditMultiplier === null) return { codexCredits: null, codexCreditCacheSavings: null };

  const inputCredits = tokenValue(input.creditUncachedInputTokens, creditPrice.inputPerMillion);
  const cacheReadCredits = tokenValue(input.cachedInputTokens, creditPrice.cachedInputPerMillion);
  const outputCredits = tokenValue(usage.outputTokens, creditPrice.outputPerMillion);
  const codexCredits = (inputCredits + cacheReadCredits + outputCredits) * creditMultiplier;
  const cacheSavings = tokenValue(
    input.cachedInputTokens,
    creditPrice.inputPerMillion - creditPrice.cachedInputPerMillion,
  );
  return { codexCredits, codexCreditCacheSavings: cacheSavings * creditMultiplier };
}

export function estimateCodexUsage(
  model: string,
  usage: CodexUsageBreakdown,
  serviceTier: CodexUsageServiceTier,
  occurredAt: string,
): CodexUsagePriceEstimate {
  const normalizedModel = normalizeCodexUsageModel(model);
  const modelPrice = codexUsageModelPrice(normalizedModel);
  // API Fast prices are independent of Codex Credits and included-usage multipliers.
  const apiPeriods = serviceTier === 'STANDARD' ? modelPrice?.api : serviceTier === 'FAST' ? modelPrice?.apiFast : [];
  const apiPrice = codexUsagePriceAt(apiPeriods ?? [], occurredAt);
  const creditPrice = codexUsagePriceAt(modelPrice?.credits ?? [], occurredAt);
  const creditMultiplier = codexUsageSpeedCreditMultiplier(normalizedModel, serviceTier);
  const input = billableInputTokens(usage);
  const api = estimateApiUsage(usage, input, apiPrice);
  const credits = estimateCreditUsage(usage, input, creditPrice, creditMultiplier);
  return {
    ...api,
    ...credits,
    apiPricedTokens: api.apiEquivalentUsd === null ? 0 : usage.totalTokens,
    creditPricedTokens: credits.codexCredits === null ? 0 : usage.totalTokens,
  };
}
