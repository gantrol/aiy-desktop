import type { CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';

const ONE_MILLION = 1_000_000;

function usableTokenCount(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function usableNonNegative(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface CodexModelComparisonCostSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputPercent: number | null;
  cachedInputCoveragePercent: number | null;
  outputPercent: number | null;
  apiEquivalentUsd: number | null;
  apiPricedTokens: number;
  apiCoveragePercent: number | null;
  apiEquivalentUsdPerMillionTokens: number | null;
  codexCredits: number | null;
  creditPricedTokens: number;
  creditCoveragePercent: number | null;
  codexCreditsPerMillionTokens: number | null;
}

export function summarizeCodexModelComparisonCosts(
  groups: readonly CodexModelComparisonRow[],
): CodexModelComparisonCostSummary {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cachedInputCoverageTokens = 0;
  let apiEquivalentUsd = 0;
  let apiPricedTokens = 0;
  let hasApiEquivalent = false;
  let codexCredits = 0;
  let creditPricedTokens = 0;
  let hasCodexCredits = false;

  for (const group of groups) {
    let groupInputTokens = 0;
    for (const sample of group.samples ?? []) {
      const sampleTotalTokens = usableTokenCount(sample[3]);
      const sampleOutputTokens = usableNonNegative(sample[4]);
      if (sampleTotalTokens !== null && sampleOutputTokens !== null && sampleOutputTokens <= sampleTotalTokens) {
        totalTokens += sampleTotalTokens;
        outputTokens += sampleOutputTokens;
        groupInputTokens += sampleTotalTokens - sampleOutputTokens;
      }

      const sampleApiUsd = usableNonNegative(sample[5]);
      if (sampleTotalTokens !== null && sampleApiUsd !== null) {
        apiPricedTokens += sampleTotalTokens;
        apiEquivalentUsd += sampleApiUsd;
        hasApiEquivalent = true;
      }

      const sampleCredits = usableNonNegative(sample[6]);
      if (sampleTotalTokens !== null && sampleCredits !== null) {
        creditPricedTokens += sampleTotalTokens;
        codexCredits += sampleCredits;
        hasCodexCredits = true;
      }
    }

    const cachedInputPercent = usableNonNegative(group.cachedInputPercent);
    if (groupInputTokens > 0 && cachedInputPercent !== null && cachedInputPercent <= 100) {
      cachedInputCoverageTokens += groupInputTokens;
      cachedInputTokens += (groupInputTokens * cachedInputPercent) / 100;
    }
  }

  inputTokens = Math.max(0, totalTokens - outputTokens);
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cachedInputPercent: cachedInputCoverageTokens > 0 ? (cachedInputTokens / cachedInputCoverageTokens) * 100 : null,
    cachedInputCoveragePercent: inputTokens > 0 ? (cachedInputCoverageTokens / inputTokens) * 100 : null,
    outputPercent: totalTokens > 0 ? (outputTokens / totalTokens) * 100 : null,
    apiEquivalentUsd: hasApiEquivalent ? apiEquivalentUsd : null,
    apiPricedTokens,
    apiCoveragePercent: totalTokens > 0 ? (apiPricedTokens / totalTokens) * 100 : null,
    apiEquivalentUsdPerMillionTokens: apiPricedTokens > 0 ? (apiEquivalentUsd * ONE_MILLION) / apiPricedTokens : null,
    codexCredits: hasCodexCredits ? codexCredits : null,
    creditPricedTokens,
    creditCoveragePercent: totalTokens > 0 ? (creditPricedTokens / totalTokens) * 100 : null,
    codexCreditsPerMillionTokens: creditPricedTokens > 0 ? (codexCredits * ONE_MILLION) / creditPricedTokens : null,
  };
}
