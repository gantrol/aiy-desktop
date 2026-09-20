import type { IpcRenderer } from 'electron';
import { z } from 'zod';
import {
  extensionMetricSourcesSchema,
  extensionMetricQuerySchema,
  extensionMetricQueryResultSchema,
  extensionMetricRefreshSchema,
  extensionMetricRefreshResultSchema,
  type ExtensionMetricsApi,
} from '@/shared/extension-metrics';
import {
  openAiCostsConnectionSaveSchema,
  openAiCostsConnectionStatusSchema,
  type OpenAiCostsConnectionApi,
} from '@/shared/openai-costs';

const spaceIdSchema = z.string().min(1).max(200);
export function createExtensionMetricsApi(ipc: Pick<IpcRenderer, 'invoke'>): ExtensionMetricsApi {
  return {
    listSources: async (spaceId) =>
      extensionMetricSourcesSchema.parse(
        await ipc.invoke('extension-metrics:list-sources', spaceIdSchema.parse(spaceId)),
      ),
    query: async (input, spaceId) =>
      extensionMetricQueryResultSchema.parse(
        await ipc.invoke(
          'extension-metrics:query',
          extensionMetricQuerySchema.parse(input),
          spaceIdSchema.parse(spaceId),
        ),
      ),
    refresh: async (input, spaceId) =>
      extensionMetricRefreshResultSchema.parse(
        await ipc.invoke(
          'extension-metrics:refresh',
          extensionMetricRefreshSchema.parse(input),
          spaceIdSchema.parse(spaceId),
        ),
      ),
  };
}
export function createOpenAiCostsConnectionApi(ipc: Pick<IpcRenderer, 'invoke'>): OpenAiCostsConnectionApi {
  return {
    status: async () => openAiCostsConnectionStatusSchema.parse(await ipc.invoke('openai-costs:connection-status')),
    save: async (input) =>
      openAiCostsConnectionStatusSchema.parse(
        await ipc.invoke('openai-costs:connection-save', openAiCostsConnectionSaveSchema.parse(input)),
      ),
    clear: async () => openAiCostsConnectionStatusSchema.parse(await ipc.invoke('openai-costs:connection-clear', {})),
  };
}
