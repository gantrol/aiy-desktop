import { z } from 'zod';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { ExtensionMetricsRegistry } from '@/main/extensions/metrics/registry';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { OpenAiCostsConnection } from '@/main/extensions/openai-image-api/costs-connection';
import {
  extensionMetricQuerySchema,
  extensionMetricQueryResultSchema,
  extensionMetricRefreshSchema,
  extensionMetricRefreshResultSchema,
  extensionMetricSourcesSchema,
} from '@/shared/extension-metrics';
import {
  openAiCostsConnectionSaveSchema,
  openAiCostsConnectionClearSchema,
  openAiCostsConnectionStatusSchema,
} from '@/shared/openai-costs';
import { OPENAI_IMAGE_API_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';

const spaceIdSchema = z.string().min(1).max(200);
export function registerExtensionMetricsIpc(
  ipc: IpcHandlerRegistrar,
  metrics: ExtensionMetricsRegistry,
  connection: OpenAiCostsConnection,
  extensions: ExtensionRegistry,
) {
  ipc.handle('extension-metrics:list-sources', async (_event, spaceId) =>
    extensionMetricSourcesSchema.parse(await metrics.listSources(spaceIdSchema.parse(spaceId))),
  );
  ipc.handle('extension-metrics:query', async (_event, raw, spaceId) =>
    extensionMetricQueryResultSchema.parse(
      await metrics.query(extensionMetricQuerySchema.parse(raw), spaceIdSchema.parse(spaceId)),
    ),
  );
  ipc.handle('extension-metrics:refresh', async (_event, raw, spaceId) =>
    extensionMetricRefreshResultSchema.parse(
      await metrics.refresh(extensionMetricRefreshSchema.parse(raw), spaceIdSchema.parse(spaceId)),
    ),
  );
  function configuredPlugin() {
    const extension = extensions.get(OPENAI_IMAGE_API_EXTENSION_ID);
    if (
      !extension?.enabled ||
      !extension.compatible ||
      !extensions.isPermissionGranted(OPENAI_IMAGE_API_EXTENSION_ID, EXTENSION_PERMISSION.accountReadOpenAiCosts)
    )
      throw new Error('OPENAI_COSTS_PERMISSION_REQUIRED');
    return connection;
  }
  ipc.handle('openai-costs:connection-status', async () =>
    openAiCostsConnectionStatusSchema.parse(await configuredPlugin().status()),
  );
  ipc.handle('openai-costs:connection-save', async (_event, raw) =>
    openAiCostsConnectionStatusSchema.parse(await configuredPlugin().save(openAiCostsConnectionSaveSchema.parse(raw))),
  );
  ipc.handle('openai-costs:connection-clear', async (_event, raw) =>
    openAiCostsConnectionStatusSchema.parse(
      await configuredPlugin().clear(openAiCostsConnectionClearSchema.parse(raw)),
    ),
  );
}
