import type { CodexUsagePricingBasis, CodexUsageServiceTier } from '@/shared/contracts/codex-usage';
import { codexUsageSpeedCreditMultiplier } from '@/shared/codex-usage-speed';

const TOKENS_PER_MILLION = 1_000_000;
export const CODEX_USAGE_LONG_CONTEXT_THRESHOLD = 272_000;

export const CODEX_USAGE_PRICING_BASIS: CodexUsagePricingBasis = {
  apiVerifiedAt: '2026-09-04',
  apiSourceUrl: 'https://developers.openai.com/api/docs/pricing',
  creditVerifiedAt: '2026-09-04',
  creditSourceUrl: 'https://learn.chatgpt.com/docs/pricing',
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

interface ApiPrice {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number | null;
  cacheWriteInputPerMillionUsd: number | null;
  outputPerMillionUsd: number;
  longContext: boolean;
}

interface ApiPricePeriod extends ApiPrice {
  effectiveFrom: string | null;
}

interface CreditPrice {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

const GPT_5_6_SOL_INITIAL_API_PRICE = {
  inputPerMillionUsd: 5,
  cachedInputPerMillionUsd: 0.5,
  cacheWriteInputPerMillionUsd: 6.25,
  outputPerMillionUsd: 30,
  longContext: true,
} satisfies ApiPrice;

const GPT_5_6_SOL_PROMOTIONAL_API_PRICE = {
  inputPerMillionUsd: 4,
  cachedInputPerMillionUsd: 0.4,
  cacheWriteInputPerMillionUsd: 5,
  outputPerMillionUsd: 20,
  longContext: true,
} satisfies ApiPrice;

const API_PRICE_HISTORY = {
  'gpt-6-astra': [
    {
      effectiveFrom: '2026-09-04',
      inputPerMillionUsd: 10,
      cachedInputPerMillionUsd: 1,
      cacheWriteInputPerMillionUsd: 12.5,
      outputPerMillionUsd: 50,
      longContext: true,
    },
  ],
  'gpt-5.6-sol': [
    { effectiveFrom: '2026-07-09', ...GPT_5_6_SOL_INITIAL_API_PRICE },
    { effectiveFrom: '2026-08-21', ...GPT_5_6_SOL_PROMOTIONAL_API_PRICE },
  ],
  'daybreak-blue': [
    { effectiveFrom: '2026-08-07', ...GPT_5_6_SOL_INITIAL_API_PRICE },
    { effectiveFrom: '2026-08-21', ...GPT_5_6_SOL_PROMOTIONAL_API_PRICE },
  ],
  'gpt-5.6-terra': [
    {
      effectiveFrom: '2026-07-09',
      inputPerMillionUsd: 2.5,
      cachedInputPerMillionUsd: 0.25,
      cacheWriteInputPerMillionUsd: 3.125,
      outputPerMillionUsd: 15,
      longContext: true,
    },
    {
      effectiveFrom: '2026-07-30',
      inputPerMillionUsd: 2,
      cachedInputPerMillionUsd: 0.2,
      cacheWriteInputPerMillionUsd: 2.5,
      outputPerMillionUsd: 12,
      longContext: true,
    },
  ],
  'gpt-5.6-luna': [
    {
      effectiveFrom: '2026-07-09',
      inputPerMillionUsd: 1,
      cachedInputPerMillionUsd: 0.1,
      cacheWriteInputPerMillionUsd: 1.25,
      outputPerMillionUsd: 6,
      longContext: true,
    },
    {
      effectiveFrom: '2026-07-30',
      inputPerMillionUsd: 0.2,
      cachedInputPerMillionUsd: 0.02,
      cacheWriteInputPerMillionUsd: 0.25,
      outputPerMillionUsd: 1.2,
      longContext: true,
    },
  ],
  'gpt-5.5': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 5,
      cachedInputPerMillionUsd: 0.5,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 30,
      longContext: true,
    },
  ],
  'gpt-5.5-pro': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 30,
      cachedInputPerMillionUsd: null,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 180,
      longContext: true,
    },
  ],
  'gpt-5.4': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 2.5,
      cachedInputPerMillionUsd: 0.25,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 15,
      longContext: true,
    },
  ],
  'gpt-5.4-pro': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 30,
      cachedInputPerMillionUsd: null,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 180,
      longContext: true,
    },
  ],
  'gpt-5.4-mini': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 0.75,
      cachedInputPerMillionUsd: 0.075,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 4.5,
      longContext: false,
    },
  ],
  'gpt-5.4-nano': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 0.2,
      cachedInputPerMillionUsd: 0.02,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 1.25,
      longContext: false,
    },
  ],
  'gpt-5.3-codex': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 1.75,
      cachedInputPerMillionUsd: 0.175,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 14,
      longContext: false,
    },
  ],
  'gpt-5.2': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 1.75,
      cachedInputPerMillionUsd: 0.175,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 14,
      longContext: false,
    },
  ],
  'gpt-5.2-pro': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 21,
      cachedInputPerMillionUsd: null,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 168,
      longContext: false,
    },
  ],
  'gpt-5-codex': [
    {
      effectiveFrom: null,
      inputPerMillionUsd: 1.25,
      cachedInputPerMillionUsd: 0.125,
      cacheWriteInputPerMillionUsd: null,
      outputPerMillionUsd: 10,
      longContext: false,
    },
  ],
} satisfies Record<string, readonly ApiPricePeriod[]>;

const CREDIT_PRICES = {
  'gpt-6-astra': { inputPerMillion: 250, cachedInputPerMillion: 25, outputPerMillion: 1250 },
  'gpt-5.6-sol': { inputPerMillion: 100, cachedInputPerMillion: 10, outputPerMillion: 500 },
  'gpt-5.6-terra': { inputPerMillion: 50, cachedInputPerMillion: 5, outputPerMillion: 300 },
  'gpt-5.6-luna': { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 },
  'gpt-5.5': { inputPerMillion: 125, cachedInputPerMillion: 12.5, outputPerMillion: 750 },
  'daybreak-blue': { inputPerMillion: 100, cachedInputPerMillion: 10, outputPerMillion: 500 },
  'daybreak-red': { inputPerMillion: 312.5, cachedInputPerMillion: 31.25, outputPerMillion: 1875 },
  'gpt-5.4': { inputPerMillion: 62.5, cachedInputPerMillion: 6.25, outputPerMillion: 375 },
  'gpt-5.4-mini': { inputPerMillion: 18.75, cachedInputPerMillion: 1.875, outputPerMillion: 113 },
  'gpt-5.3-codex': { inputPerMillion: 43.75, cachedInputPerMillion: 4.375, outputPerMillion: 350 },
  'gpt-5.2': { inputPerMillion: 43.75, cachedInputPerMillion: 4.375, outputPerMillion: 350 },
} satisfies Record<string, CreditPrice>;

type ApiPriceKey = keyof typeof API_PRICE_HISTORY;
type CreditPriceKey = keyof typeof CREDIT_PRICES;

export function normalizeCodexUsageModel(model: string) {
  const value = model.trim().toLowerCase();
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

function apiPriceAt(key: string, occurredAt: string): ApiPrice | null {
  if (!(key in API_PRICE_HISTORY) || occurredAt.length < 10) return null;
  const occurredOn = occurredAt.slice(0, 10);
  const periods = API_PRICE_HISTORY[key as ApiPriceKey];
  let price: ApiPrice | null = null;
  for (const period of periods) {
    if (period.effectiveFrom !== null && period.effectiveFrom > occurredOn) break;
    price = period;
  }
  return price;
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
  const apiPrice = apiPriceAt(key, occurredAt);
  const creditPrice = key in CREDIT_PRICES ? CREDIT_PRICES[key as CreditPriceKey] : null;
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
