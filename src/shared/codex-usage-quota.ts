import type { CodexUsageQuotaCycle, CodexUsageQuotaYieldAnalysis } from '@/shared/contracts/codex-usage';
import { codexUsageSpeedCreditMultiplier } from '@/shared/codex-usage-speed';

export function codexUsageQuotaTokenBounds(cycle: CodexUsageQuotaCycle) {
  let minimumTokens = 0;
  let maximumTokens: number | null = 0;
  let knownTokens = 0;
  let sharedTokens = 0;
  for (const share of cycle.modelShares) {
    sharedTokens += share.totalTokens;
    const multiplier = codexUsageSpeedCreditMultiplier(share.model, share.serviceTier);
    if (multiplier !== null) {
      minimumTokens += share.totalTokens * multiplier;
      if (maximumTokens !== null) maximumTokens += share.totalTokens * multiplier;
      knownTokens += share.totalTokens;
      continue;
    }
    minimumTokens += share.totalTokens;
    const fastMultiplier = codexUsageSpeedCreditMultiplier(share.model, 'FAST');
    maximumTokens =
      maximumTokens !== null && fastMultiplier !== null ? maximumTokens + share.totalTokens * fastMultiplier : null;
  }
  // Reject inconsistent shares; unclassified residual tokens contribute only a lower bound.
  if (sharedTokens > cycle.totalTokens) return null;
  if (sharedTokens < cycle.totalTokens) {
    minimumTokens += cycle.totalTokens - sharedTokens;
    maximumTokens = null;
  }
  return { minimumTokens, maximumTokens, knownTokens, totalTokens: cycle.totalTokens };
}

export function codexUsageNonFastTokensPerFullQuota(analysis: CodexUsageQuotaYieldAnalysis | null) {
  if (!analysis || !analysis.cycles.length) return null;
  let quotaPercent = 0;
  let minimumTokens = 0;
  let maximumTokens: number | null = 0;
  let knownTokens = 0;
  let totalTokens = 0;
  let excludedCycles = 0;
  let observedFrom: string | null = null;
  let observedTo: string | null = null;
  const modelTokens = new Map<string, number>();
  const streams = new Set<string>();
  for (const cycle of analysis.cycles) {
    if (cycle.quotaKind !== 'MAIN' || cycle.windowDurationMins !== 10_080) {
      excludedCycles += 1;
      continue;
    }
    const bounds = codexUsageQuotaTokenBounds(cycle);
    if (!bounds || cycle.totalTokens <= 0 || cycle.quotaPercentConsumed <= 0) {
      excludedCycles += 1;
      continue;
    }
    streams.add(
      JSON.stringify([
        cycle.planType.trim().toLowerCase(),
        cycle.limitId?.trim().toLowerCase() ?? '',
        cycle.windowKind,
      ]),
    );
    quotaPercent += cycle.quotaPercentConsumed;
    minimumTokens += bounds.minimumTokens;
    maximumTokens =
      maximumTokens !== null && bounds.maximumTokens !== null ? maximumTokens + bounds.maximumTokens : null;
    knownTokens += bounds.knownTokens;
    totalTokens += bounds.totalTokens;
    if (observedFrom === null || cycle.observedFrom < observedFrom) observedFrom = cycle.observedFrom;
    if (observedTo === null || cycle.observedTo > observedTo) observedTo = cycle.observedTo;
    for (const share of cycle.modelShares) {
      if (share.totalTokens > 0) modelTokens.set(share.model, (modelTokens.get(share.model) ?? 0) + share.totalTokens);
    }
  }
  // Different plans and quota pools do not share a meaningful 100% denominator.
  if (streams.size !== 1 || quotaPercent <= 0 || totalTokens <= 0) return null;
  const minimumTokensPerFullQuota = (minimumTokens / quotaPercent) * 100;
  const maximumTokensPerFullQuota = maximumTokens === null ? null : (maximumTokens / quotaPercent) * 100;
  if (
    !Number.isFinite(minimumTokensPerFullQuota) ||
    (maximumTokensPerFullQuota !== null && !Number.isFinite(maximumTokensPerFullQuota))
  )
    return null;
  return {
    minimumTokensPerFullQuota,
    maximumTokensPerFullQuota,
    quotaPercent,
    observedTokens: totalTokens,
    observedFrom,
    observedTo,
    models: [...modelTokens]
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model)),
    coveragePercent: (knownTokens / totalTokens) * 100,
    partial: analysis.samplesTruncated || excludedCycles > 0 || analysis.unattributedQuotaPercent > 0,
    legacy: analysis.algorithmVersion < 10,
  };
}
