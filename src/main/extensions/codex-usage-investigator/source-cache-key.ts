import { createHash } from 'node:crypto';
import type { CodexUsageFileFingerprint } from '@/main/extensions/codex-usage-investigator/cache-records';
import type { CodexUsageServiceTierFallback } from '@/main/extensions/codex-usage-investigator/service-tier-fallback';

const SOURCE_ANALYSIS_VERSION = 14;

export function codexUsageSourceCacheKey(
  file: CodexUsageFileFingerprint,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  return sourceCacheKey(file, serviceTierFallback, SOURCE_ANALYSIS_VERSION);
}

// Revision 14 retains terminals without starts. Complete revision 13 sources can be reused.
export function codexUsagePreviousSourceCacheKey(
  file: CodexUsageFileFingerprint,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  return sourceCacheKey(file, serviceTierFallback, 13);
}

export function codexUsageSourceCacheMatches(
  stored: { cacheKey: string; needsSourceRecovery: 0 | 1 } | undefined,
  file: CodexUsageFileFingerprint,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  return (
    stored !== undefined &&
    (stored.cacheKey === codexUsageSourceCacheKey(file, serviceTierFallback) ||
      (!stored.needsSourceRecovery && stored.cacheKey === codexUsagePreviousSourceCacheKey(file, serviceTierFallback)))
  );
}

function sourceCacheKey(
  file: CodexUsageFileFingerprint,
  serviceTierFallback: CodexUsageServiceTierFallback | null | undefined,
  version: number,
) {
  const applicableFallback =
    serviceTierFallback && file.mtimeMs >= serviceTierFallback.effectiveFromEpoch ? serviceTierFallback : null;
  return createHash('sha256')
    .update(
      JSON.stringify({
        version,
        cumulativeUsageBasis: 'LAST_USAGE_ON_COUNTER_RESTART',
        sessionId: file.sessionId,
        fallbackModel: file.fallbackModel,
        threadSource: file.threadSource,
        createdAtMs: file.createdAtMs,
        size: file.size,
        mtimeNs: file.mtimeNs,
        ctimeNs: file.ctimeNs,
        serviceTierFallback: applicableFallback
          ? {
              serviceTier: applicableFallback.serviceTier,
              effectiveFromEpoch: applicableFallback.effectiveFromEpoch,
              sourceRevision: applicableFallback.sourceRevision,
            }
          : null,
      }),
      'utf8',
    )
    .digest('hex');
}
