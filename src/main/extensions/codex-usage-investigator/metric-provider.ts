import { stat } from 'node:fs/promises';
import path from 'node:path';
import { CodexUsageCacheDatabase } from '@/main/extensions/codex-usage-investigator/cache-database';
import type { StoredEventRow } from '@/main/extensions/codex-usage-investigator/cache-records';
import { metricDigest, metricPage } from '@/main/extensions/metrics/pagination';
import type { ExtensionMetricProvider } from '@/main/extensions/metrics/registry';
import { MetricSnapshotCache } from '@/main/extensions/metrics/snapshot-cache';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import {
  CODEX_LOCAL_METRIC_PROVIDER_ID,
  CODEX_QUOTA_METRIC_PROVIDER_ID,
  extensionQuotaFactSchema,
  type ExtensionMetricFact,
  type ExtensionQuotaFact,
} from '@/shared/extension-metrics';
import { codexUsageQuotaSnapshotSchema, type CodexUsageQuotaSnapshot } from '@/shared/contracts/codex-usage';

const localNotes = ['CODEX_LOCAL_LOGS_SCOPE', 'CODEX_LOCAL_LOGS_RECONSTRUCTED', 'CODEX_LOCAL_LOGS_MODEL_UNVERIFIED'];

function epochSeconds(value: number | null) {
  if (value === null) return null;
  const millis = value * 1000;
  return Number.isSafeInteger(millis) && Math.abs(millis) <= 8.64e15 ? new Date(millis).toISOString() : null;
}

function logQuota(row: StoredEventRow, window: 'PRIMARY' | 'SECONDARY'): ExtensionQuotaFact | null {
  const usedPercent = window === 'PRIMARY' ? row.usedPercent : row.secondaryUsedPercent;
  if (usedPercent === null) return null;
  const duration = window === 'PRIMARY' ? row.windowDurationMins : row.secondaryWindowDurationMins;
  const resetsAt = window === 'PRIMARY' ? row.resetsAt : row.secondaryResetsAt;
  const id = `quota:${row.sessionId}:${row.eventOrder}:${window}`;
  return {
    kind: 'QUOTA',
    id,
    revision: metricDigest([row, window]),
    period: { startAt: row.timestamp, endAt: row.timestamp },
    observedAt: row.timestamp,
    originalRecord: { type: 'CODEX_LOCAL_LOG_EVENT', id: `${row.sessionId}:${row.eventOrder}` },
    notes: ['CODEX_HISTORICAL_QUOTA_SAMPLE'],
    basis: 'LOCAL_LOG_SAMPLE',
    poolId: row.limitId,
    poolName: row.limitId,
    window,
    windowDurationSeconds: duration === null ? null : duration * 60,
    usedPercent,
    used: null,
    limit: null,
    remaining: null,
    unit: null,
    resetsAt: epochSeconds(resetsAt),
  };
}

function* logFacts(cache: CodexUsageCacheDatabase, start: number, end: number): Iterable<ExtensionMetricFact> {
  for (const page of cache.metricEventPages(start, end - 1)) {
    for (const row of page) {
      // Zero cache rows may be quota-only records or unknown usage normalized by the old parser.
      if (row.totalTokens > 0) {
        yield {
          kind: 'USAGE',
          id: `usage:${row.sessionId}:${row.eventOrder}`,
          revision: metricDigest(row),
          period: { startAt: row.timestamp, endAt: row.timestamp },
          observedAt: null,
          originalRecord: { type: 'CODEX_LOCAL_LOG_EVENT', id: `${row.sessionId}:${row.eventOrder}` },
          notes: ['CODEX_PARSED_EVENT_CONSUMPTION'],
          basis: 'PLUGIN_RECONSTRUCTED',
          temporality: 'DELTA',
          completeness: 'PARTIAL',
          requestedModel: null,
          observedModel: null,
          contextModel: row.model === 'unknown' ? null : row.model,
          requests: null,
          inputTokens: row.inputTokens,
          cachedInputTokens: null,
          outputTokens: row.outputTokens,
          reasoningOutputTokens: null,
          totalTokens: row.totalTokens,
          images: null,
          durationSeconds: null,
        };
      }
      const primary = logQuota(row, 'PRIMARY');
      const secondary = logQuota(row, 'SECONDARY');
      if (primary) yield primary;
      if (secondary) yield secondary;
    }
  }
}

export function createCodexLocalMetricProvider(dataDirectory: string): ExtensionMetricProvider {
  return {
    id: CODEX_LOCAL_METRIC_PROVIDER_ID,
    extensionId: CODEX_EXTENSION_ID,
    nameKey: 'CODEX_LOCAL_LOGS',
    kinds: ['USAGE', 'QUOTA'],
    requiredPermissions: [EXTENSION_PERMISSION.filesystemReadCodexSessionUsage],
    refreshMode: 'NONE',
    describe: () => ({
      scope: {
        kind: 'DEVICE',
        id: null,
        identityBasis: 'LOCAL_DEVICE',
        labelKey: 'CODEX_LOCAL_DEVICE',
        labelValue: null,
      },
      notes: localNotes,
    }),
    async query(input, context) {
      context.assertActive();
      const filePath = path.join(dataDirectory, 'usage-cache.sqlite');
      const key = metricDigest([CODEX_LOCAL_METRIC_PROVIDER_ID, context.scope]);
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return metricPage(input, metricDigest([key, 'NOT_RECORDED']), key, [], {
          state: 'EMPTY',
          notes: ['CODEX_NO_SCAN_CACHE'],
        });
      }
      const cache = CodexUsageCacheDatabase.openExistingReadOnly(dataDirectory);
      try {
        return cache.readMetricSnapshot((revision) =>
          metricPage(
            input,
            metricDigest([key, fileStat.ino, fileStat.birthtimeMs, revision]),
            key,
            logFacts(cache, Date.parse(input.startAt), Date.parse(input.endAt)),
            { state: 'PARTIAL', notes: localNotes },
          ),
        );
      } catch (error) {
        if (error instanceof Error && /no such (?:table|column)/i.test(error.message)) {
          return metricPage(input, metricDigest([key, 'CACHE_SCHEMA_UNAVAILABLE']), key, [], {
            state: 'UNAVAILABLE',
            notes: ['CODEX_CACHE_SCHEMA_UNAVAILABLE'],
          });
        }
        throw error;
      } finally {
        cache.close();
      }
    },
  };
}

export function createCodexQuotaMetricProvider(options: {
  cachePath: string;
  readQuota(signal: AbortSignal): Promise<CodexUsageQuotaSnapshot>;
}): ExtensionMetricProvider {
  const cache = new MetricSnapshotCache(options.cachePath);
  const sourceKey = metricDigest([CODEX_QUOTA_METRIC_PROVIDER_ID, 'UNIDENTIFIED_ACCOUNT']);
  return {
    id: CODEX_QUOTA_METRIC_PROVIDER_ID,
    extensionId: CODEX_EXTENSION_ID,
    nameKey: 'CODEX_ACCOUNT_QUOTA',
    kinds: ['QUOTA'],
    requiredPermissions: [EXTENSION_PERMISSION.accountReadCodexRateLimits],
    refreshPermissions: [EXTENSION_PERMISSION.integrationConnectCodexAppServer],
    refreshMode: 'CURRENT_SNAPSHOT',
    describe: () => ({
      scope: {
        kind: 'ACCOUNT',
        id: null,
        identityBasis: 'UNIDENTIFIED',
        labelKey: 'CODEX_ACCOUNT_UNIDENTIFIED',
        labelValue: null,
      },
      notes: ['CODEX_ACCOUNT_ID_UNAVAILABLE'],
    }),
    query: (input) => cache.query(input, sourceKey),
    async refresh(_input, context) {
      context.assertActive();
      const quota = codexUsageQuotaSnapshotSchema.parse(await options.readQuota(context.signal));
      context.assertActive();
      const facts = quota.limits.flatMap((limit, index) =>
        (['PRIMARY', 'SECONDARY'] as const).flatMap((window) => {
          const sample = window === 'PRIMARY' ? limit.primary : limit.secondary;
          if (!sample) return [];
          const id = metricDigest([quota.capturedAt, limit.limitId, index, window]);
          return [
            extensionQuotaFactSchema.parse({
              kind: 'QUOTA',
              id,
              revision: metricDigest([quota, index, window]),
              period: { startAt: quota.capturedAt, endAt: quota.capturedAt },
              observedAt: quota.capturedAt,
              originalRecord: { type: 'CODEX_ACCOUNT_RATE_LIMIT_SNAPSHOT', id },
              notes: ['CODEX_QUOTA_SNAPSHOT'],
              basis: 'PROVIDER_REPORTED',
              poolId: limit.limitId,
              poolName: limit.limitName,
              window,
              windowDurationSeconds: sample.windowDurationMins === null ? null : sample.windowDurationMins * 60,
              usedPercent: sample.usedPercent,
              used: null,
              limit: null,
              remaining: null,
              unit: null,
              resetsAt: epochSeconds(sample.resetsAt),
            }),
          ];
        }),
      );
      const coverage = {
        state: 'PARTIAL' as const,
        notes: ['CODEX_QUOTA_WINDOW_CACHE'],
      };
      await cache.save({
        sourceKey,
        startAt: quota.capturedAt,
        endAt: new Date(Date.parse(quota.capturedAt) + 1).toISOString(),
        capturedAt: quota.capturedAt,
        mode: 'APPEND',
        coverage,
        facts,
        original: quota,
      });
      return coverage;
    },
  };
}
