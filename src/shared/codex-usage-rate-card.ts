import bundledRateCard from './codex-usage-rate-card.json';

export interface CodexUsageApiPricePeriod {
  effectiveFrom: string | null;
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number | null;
  cacheWriteInputPerMillionUsd: number | null;
  outputPerMillionUsd: number;
  longContext: boolean;
}

export interface CodexUsageCreditPricePeriod {
  effectiveFrom: string | null;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export interface CodexUsageModelPrice {
  aliases: string[];
  verifiedAt: string;
  sourceUrls: string[];
  api: CodexUsageApiPricePeriod[];
  credits: CodexUsageCreditPricePeriod[];
  fastCreditMultiplier: number | null;
  // Older verified entries use a shared multiplier; newer rates can distinguish included usage.
  fastIncludedUsageMultiplier?: number | null;
}

export interface CodexUsageRateCard {
  schemaVersion: number;
  updatedAt: string;
  apiSourceUrl: string;
  creditSourceUrl: string;
  longContextThresholdTokens: number;
  models: Record<string, CodexUsageModelPrice>;
}

// Bundled data only. Validate authoring changes with scripts/verify-codex-usage-pricing.mjs.
export const CODEX_USAGE_RATE_CARD: CodexUsageRateCard = bundledRateCard;

export function codexUsageModelPrice(model: string): CodexUsageModelPrice | null {
  return Object.hasOwn(CODEX_USAGE_RATE_CARD.models, model) ? CODEX_USAGE_RATE_CARD.models[model] : null;
}

export function codexUsageCatalogModel(model: string): string | null {
  const value = model.trim().toLowerCase();
  if (codexUsageModelPrice(value)) return value;
  for (const [key, price] of Object.entries(CODEX_USAGE_RATE_CARD.models)) {
    if (price.aliases.includes(value)) return key;
  }
  // Recognize dated snapshots, not arbitrary suffixes such as "-pro" or "-preview".
  const snapshot = /^(.*)-(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!snapshot || !codexUsagePriceDate(snapshot[2])) return null;
  return codexUsageModelPrice(snapshot[1]) ? snapshot[1] : null;
}

export function codexUsagePriceDate(value: string): string | null {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const epoch = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === date ? date : null;
}

export function codexUsagePriceAt<T extends { effectiveFrom: string | null }>(
  periods: readonly T[],
  occurredAt: string,
): T | null {
  const occurredOn = codexUsagePriceDate(occurredAt);
  if (occurredOn === null) return null;
  let price: T | null = null;
  for (const period of periods) {
    if (period.effectiveFrom !== null && period.effectiveFrom > occurredOn) break;
    price = period;
  }
  return price;
}
