import type { CodexUsageQuotaPurity, CodexUsageQuotaPuritySample } from '@/shared/contracts/codex-usage';

export function groupCodexQuotaPurity(analysis: CodexUsageQuotaPurity | null) {
  const groups = new Map<
    string,
    { key: string; sample: CodexUsageQuotaPuritySample; samples: CodexUsageQuotaPuritySample[]; quota: number }
  >();
  for (const sample of analysis?.samples ?? []) {
    const key = JSON.stringify([
      sample.model,
      sample.serviceTier,
      sample.planType,
      sample.limitId,
      sample.quotaKind,
      sample.windowKind,
      sample.windowDurationMins,
    ]);
    const group = groups.get(key) ?? { key, sample, samples: [], quota: 0 };
    group.samples.push(sample);
    group.quota += sample.quotaPercentConsumed;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.samples.sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from));
  }
  return [...groups.values()].sort((a, b) => b.quota - a.quota || a.key.localeCompare(b.key));
}
