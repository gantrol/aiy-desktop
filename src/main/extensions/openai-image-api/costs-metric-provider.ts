import type { OpenAiCostsConnection } from '@/main/extensions/openai-image-api/costs-connection';
import { fetchOpenAiCosts } from '@/main/extensions/openai-image-api/costs-client';
import { MetricSnapshotCache } from '@/main/extensions/metrics/snapshot-cache';
import { metricDigest } from '@/main/extensions/metrics/pagination';
import type { ExtensionMetricProvider } from '@/main/extensions/metrics/registry';
import { OPENAI_IMAGE_API_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import {
  OPENAI_COSTS_METRIC_PROVIDER_ID,
  extensionCostFactSchema,
  type ExtensionCostFact,
} from '@/shared/extension-metrics';
import type { OpenAiCostsRefreshResult } from '@/shared/openai-costs';

export function openAiCostFacts(response: OpenAiCostsRefreshResult): ExtensionCostFact[] {
  const unique = new Map<string, ExtensionCostFact>();
  for (const page of response.pages) {
    for (const bucket of page.buckets) {
      for (const result of bucket.results) {
        const rawCurrency = result.amount?.currency?.toUpperCase() ?? null;
        const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
        const id = metricDigest([
          response.connectionId,
          bucket.startTime,
          bucket.endTime,
          result.projectId,
          result.lineItem,
          result.apiKeyId,
          currency,
        ]);
        const fact = extensionCostFactSchema.parse({
          kind: 'COST',
          id,
          revision: metricDigest(result),
          period: {
            startAt: new Date(bucket.startTime * 1000).toISOString(),
            endAt: new Date(bucket.endTime * 1000).toISOString(),
          },
          observedAt: response.capturedAt,
          originalRecord: { type: 'OPENAI_ORGANIZATION_COST_BUCKET', id },
          notes: [
            'OPENAI_COST_BUCKET',
            ...(result.amount?.value == null || currency === null ? ['OPENAI_AMOUNT_UNKNOWN'] : []),
          ],
          basis: 'PROVIDER_REPORTED',
          amount: result.amount?.value ?? null,
          currency,
          pricingReference: null,
          lineItem: result.lineItem,
          projectId: result.projectId,
          apiKeyId: result.apiKeyId,
          quantity: result.quantity,
          quantityUnit: result.quantityUnit,
        });
        const previous = unique.get(id);
        if (previous && previous.revision !== fact.revision) throw new Error('OPENAI_COSTS_RESPONSE_CONFLICT');
        unique.set(id, fact);
      }
    }
  }
  return [...unique.values()];
}

export function createOpenAiCostsMetricProvider(options: {
  connection: OpenAiCostsConnection;
  cachePath: string;
}): ExtensionMetricProvider {
  const cache = new MetricSnapshotCache(options.cachePath);
  const sourceKey = (connectionId: string | null) => metricDigest([OPENAI_COSTS_METRIC_PROVIDER_ID, connectionId]);
  return {
    id: OPENAI_COSTS_METRIC_PROVIDER_ID,
    extensionId: OPENAI_IMAGE_API_EXTENSION_ID,
    nameKey: 'OPENAI_ORGANIZATION_COSTS',
    kinds: ['COST'],
    requiredPermissions: [EXTENSION_PERMISSION.accountReadOpenAiCosts],
    refreshPermissions: [EXTENSION_PERMISSION.credentialsUseOpenAiAdminKey, 'network:https://api.openai.com'],
    refreshMode: 'QUERY_RANGE',
    async describe() {
      const status = await options.connection.status();
      return {
        scope: {
          kind: 'ACCOUNT',
          id: status.connectionId,
          identityBasis: status.connectionId ? 'CONNECTION' : 'UNIDENTIFIED',
          labelKey: status.organizationId ? 'OPENAI_ORGANIZATION' : 'OPENAI_ADMIN_CONNECTION',
          labelValue: status.organizationId,
        },
        unavailableReason: status.state === 'ERROR' ? 'UNAVAILABLE' : status.configured ? null : 'UNCONFIGURED',
        notes: ['OPENAI_ADMIN_SCOPE', 'OPENAI_CACHE_SCOPE'],
      };
    },
    query(input, context) {
      return cache.query(input, sourceKey(context.scope.id));
    },
    async refresh(input, context) {
      context.assertActive();
      const credentials = await options.connection.credentials();
      if (!credentials || credentials.connectionId !== context.scope.id)
        throw new Error('EXTENSION_METRICS_SCOPE_CHANGED');
      let response: OpenAiCostsRefreshResult;
      try {
        response = await fetchOpenAiCosts(
          credentials,
          {
            startTime: Math.floor(Date.parse(input.startAt) / 1000),
            endTime: Math.ceil(Date.parse(input.endAt) / 1000),
          },
          context.signal,
          fetch,
          context.assertActive,
        );
      } catch (error) {
        context.assertActive();
        throw error;
      }
      context.assertActive();
      const facts = openAiCostFacts(response);
      const coverage = {
        state: 'COMPLETE' as const,
        notes: ['OPENAI_REFRESH_COMPLETE'],
      };
      await cache.save({
        sourceKey: sourceKey(credentials.connectionId),
        startAt: input.startAt,
        endAt: input.endAt,
        capturedAt: response.capturedAt,
        mode: 'REPLACE_RANGE',
        coverage,
        facts,
        original: response,
      });
      return coverage;
    },
  };
}
