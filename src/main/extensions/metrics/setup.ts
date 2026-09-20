import path from 'node:path';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import { ExtensionMetricsRegistry } from '@/main/extensions/metrics/registry';
import {
  createCodexLocalMetricProvider,
  createCodexQuotaMetricProvider,
} from '@/main/extensions/codex-usage-investigator/metric-provider';
import { OpenAiCostsConnection } from '@/main/extensions/openai-image-api/costs-connection';
import { createOpenAiCostsMetricProvider } from '@/main/extensions/openai-image-api/costs-metric-provider';
import {
  CODEX_EXTENSION_ID,
  CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';

export function createApplicationMetrics(options: {
  userDataPath: string;
  secretProtector: SecretProtector;
  extensions: ExtensionRegistry;
  getContext(): ActiveLibraryContext | null;
}) {
  const directory = (id: string) => path.join(options.userDataPath, 'extension-data', id);
  const current = () => {
    const context = options.getContext();
    if (context?.state !== 'ACTIVE') throw new Error('EXTENSION_METRICS_SPACE_UNAVAILABLE');
    return context;
  };
  const connection = new OpenAiCostsConnection(
    path.join(directory(OPENAI_IMAGE_API_EXTENSION_ID), 'costs-admin-connection.json'),
    options.secretProtector,
  );
  const metrics = new ExtensionMetricsRegistry({
    extensions: options.extensions,
    currentSpace: () => {
      const context = current();
      return { spaceId: context.database.getLocalSpace().id, instance: context.database.db };
    },
  })
    .register(createCodexLocalMetricProvider(directory(CODEX_USAGE_INVESTIGATOR_EXTENSION_ID)))
    .register(
      createCodexQuotaMetricProvider({
        cachePath: path.join(directory(CODEX_EXTENSION_ID), 'quota-metrics.sqlite'),
        readQuota: async (signal) => {
          const context = current();
          const release = context.acquireOperation();
          try {
            return await context.codex.readUsageQuota(signal);
          } finally {
            release();
          }
        },
      }),
    )
    .register(
      createOpenAiCostsMetricProvider({
        connection,
        cachePath: path.join(directory(OPENAI_IMAGE_API_EXTENSION_ID), 'costs-metrics.sqlite'),
      }),
    );
  return { metrics, connection };
}
