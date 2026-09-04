import { createHash } from 'node:crypto';
import type { CodexUsageFileFingerprint } from '@/main/extensions/codex-usage-investigator/cache-records';
import type { CodexUsageServiceTierFallback } from '@/main/extensions/codex-usage-investigator/service-tier-fallback';

const SOURCE_ANALYSIS_VERSION = 10;

export function codexUsageSourceCacheKey(
  file: CodexUsageFileFingerprint,
  serviceTierFallback?: CodexUsageServiceTierFallback | null,
) {
  const applicableFallback =
    serviceTierFallback && file.mtimeMs >= serviceTierFallback.effectiveFromEpoch ? serviceTierFallback : null;
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: SOURCE_ANALYSIS_VERSION,
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
