import { createHash } from 'node:crypto';
import type { CodexUsageFileFingerprint } from '@/main/extensions/codex-usage-investigator/cache-records';
import type { CodexUsageServiceTierFallback } from '@/main/extensions/codex-usage-investigator/service-tier-fallback';

const SOURCE_ANALYSIS_VERSION = 12;

export function codexUsageSourceCacheKey(
  file: CodexUsageFileFingerprint,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  return sourceCacheKey(file, serviceTierFallback, SOURCE_ANALYSIS_VERSION);
}

// Revision 12 only changes context-free UNKNOWN history. Unaffected revision 11
// sources can be reused without rereading every rollout after an application update.
export function codexUsagePreviousSourceCacheKey(
  file: CodexUsageFileFingerprint,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  return sourceCacheKey(file, serviceTierFallback, 11);
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
