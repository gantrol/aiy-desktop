import path from 'node:path';
import {
  app,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron';
import type { CodexService } from '@/main/assistant/codex-service';
import { ASSISTANT_MODEL_DEFINITIONS, type AssistantRoutingConfiguration } from '@/main/assistant/assistant-routing';
import type { CodexImageDiscovery } from '@/main/extensions/codex-image-discovery';
import type { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import {
  externalImageApiEndpointPermission,
  type ExternalImageApiConnections,
} from '@/main/extensions/external-image-api';
import type { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { GenerationConcurrencyConfiguration } from '@/main/generation/concurrency-configuration';
import type { GenerationService } from '@/main/generation/service';
import {
  assistantRoutingSaveSchema,
  codexGeneratedImageImportSchema,
  codexGeneratedImageListSchema,
  codexGeneratedImageRecoverSchema,
  deepSeekApiSaveSchema,
  extensionSetEnabledSchema,
  extensionSetPermissionSchema,
  externalImageApiExtensionIdSchema,
  externalImageApiSaveSchema,
  generationConcurrencySaveSchema,
  id,
  openAiImageApiSaveSchema,
} from '@/main/ipc/schemas';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { registerCodexUsageIpc } from '@/main/ipc/codex-usage-handlers';
import type { AntigravityCliStatusDto, CodexTextModelDto } from '@/shared/contracts';
import {
  ANTIGRAVITY_CLI_DEFAULT_MODEL_KEY,
  ANTIGRAVITY_CLI_PROVIDER_KEY,
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  OPENAI_IMAGE_CONNECTION_ID,
  externalImageConnectionId,
} from '@/shared/extension-ids';
import { resolveImageGenerationRouteExecutionIdentity } from '@/shared/image-generation-route-identity';

interface ExtensionSettingsIpcOptions {
  ipcMain: IpcHandlerRegistrar;
  extensions: ExtensionRegistry;
  codexImageDiscovery: CodexImageDiscovery;
  openAiImageApi: OpenAiImageApiConnection;
  deepSeekApi: DeepSeekApiConnection;
  assistantRouting: AssistantRoutingConfiguration;
  externalImageApis: ExternalImageApiConnections;
  generation: GenerationService;
  generationConcurrency: GenerationConcurrencyConfiguration;
  codex: CodexService;
  chooseFile: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  chooseSaveFile: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  sendRendererEvent(channel: string, ...args: unknown[]): boolean;
}

function registerCodexImageDiscoveryIpc(
  ipcMain: IpcHandlerRegistrar,
  extensions: ExtensionRegistry,
  codexImageDiscovery: CodexImageDiscovery,
) {
  const active = () => {
    if (!extensions.isActivated(CODEX_IMAGE_DISCOVERY_EXTENSION_ID)) {
      throw new Error('Codex Image Discovery is disabled or missing permissions');
    }
  };
  const invoke = <T>(operation: () => T) => {
    active();
    return operation();
  };
  ipcMain.handle('codex-generated-images:list', (_event, raw) =>
    invoke(() => codexImageDiscovery.list(codexGeneratedImageListSchema.parse(raw))),
  );
  ipcMain.handle('codex-generated-images:import', (_event, raw) =>
    invoke(() => codexImageDiscovery.importImages(codexGeneratedImageImportSchema.parse(raw))),
  );
  ipcMain.handle('codex-generated-images:recover', (_event, raw) =>
    invoke(() => codexImageDiscovery.recoverImage(codexGeneratedImageRecoverSchema.parse(raw).discoveryId)),
  );
}

export function registerExtensionSettingsIpc({
  ipcMain,
  extensions,
  codexImageDiscovery,
  openAiImageApi,
  deepSeekApi,
  assistantRouting,
  externalImageApis,
  generation,
  generationConcurrency,
  codex,
  chooseFile,
  chooseSaveFile,
  sendRendererEvent,
}: ExtensionSettingsIpcOptions) {
  const unavailableAntigravityStatus = (): AntigravityCliStatusDto => ({
    state: 'unavailable',
    version: '',
    authenticated: false,
    message: 'Background model service is unavailable',
    currentModel: null,
    models: [],
    quota: { warning: 'UNAVAILABLE', groups: [], checkedAt: null, message: 'Quota is unavailable' },
  });
  const syncExternalImageApiRuntime = async () => {
    await generation.configureExternalImageApis?.(
      externalImageApis.runtimeConfigurations((extensionId, permission) =>
        extensions.isPermissionGranted(extensionId, permission),
      ),
    );
  };
  const syncDeepSeekApiRuntime = async () => {
    await generation.configureDeepSeekApi?.(deepSeekApi.runtimeConfiguration());
  };
  ipcMain.handle('extensions:list', () => extensions.list());
  const codexUsage = registerCodexUsageIpc({
    ipcMain,
    extensions,
    codex,
    dataDirectory: path.join(app.getPath('userData'), 'extension-data', CODEX_USAGE_INVESTIGATOR_EXTENSION_ID),
    chooseSaveFile,
    sendRendererEvent,
  });
  const hasPendingExtensionWork = (extensionId: string) =>
    generation.hasPending ||
    codex.hasPending ||
    (extensionId === CODEX_USAGE_INVESTIGATOR_EXTENSION_ID && codexUsage.hasPending);
  ipcMain.handle('extension-language-packs:list', () => extensions.listLanguagePacks());
  ipcMain.handle('extension:install-local', async () => {
    const selection = await chooseFile({ properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) {
      return { extensionId: null, extensions: extensions.list() };
    }
    return extensions.installLocal(selection.filePaths[0]);
  });
  ipcMain.handle('extension:uninstall-local', (_event, rawExtensionId) =>
    extensions.uninstallLocal(id.parse(rawExtensionId)),
  );
  const syncCodexImageDiscovery = () =>
    codexImageDiscovery.setActive(extensions.isActivated(CODEX_IMAGE_DISCOVERY_EXTENSION_ID));
  ipcMain.handle('extension:set-enabled', async (_event, raw) => {
    const input = extensionSetEnabledSchema.parse(raw);
    if (!input.enabled && hasPendingExtensionWork(input.extensionId)) {
      throw new Error('Wait for active model tasks to finish before disabling an extension');
    }
    extensions.setEnabled(input.extensionId, input.enabled);
    await syncCodexImageDiscovery();
    await generation.refreshExtensions?.();
    await syncDeepSeekApiRuntime();
    await syncExternalImageApiRuntime();
    return extensions.list();
  });
  ipcMain.handle('extension:set-permission', async (_event, raw) => {
    const input = extensionSetPermissionSchema.parse(raw);
    if (!input.granted && hasPendingExtensionWork(input.extensionId)) {
      throw new Error('Wait for active model tasks to finish before revoking a permission');
    }
    extensions.setPermission(input.extensionId, input.permission, input.granted);
    await syncCodexImageDiscovery();
    await generation.refreshExtensions?.();
    await syncDeepSeekApiRuntime();
    await syncExternalImageApiRuntime();
    return extensions.list();
  });
  registerCodexImageDiscoveryIpc(ipcMain, extensions, codexImageDiscovery);
  const syncOpenAiImageApiRuntime = async () => {
    await generation.configureOpenAiImageApi?.(openAiImageApi.runtimeConfiguration());
  };
  const hasPendingImageConnection = (connectionId: string) => {
    const pendingRouteKeys = new Set(generation.tasks.map((task) => task.modelKey));
    return generation.imageGenerationRoutes.some(
      (route) =>
        pendingRouteKeys.has(route.key) &&
        resolveImageGenerationRouteExecutionIdentity(route).connectionId === connectionId,
    );
  };
  const assertOpenAiImageApiMutable = () => {
    if (hasPendingImageConnection(OPENAI_IMAGE_CONNECTION_ID)) {
      throw new Error('Wait for active OpenAI image tasks before changing OpenAI API configuration');
    }
  };
  ipcMain.handle('openai-image-api:get', () => openAiImageApi.status());
  ipcMain.handle('openai-image-api:save', async (_event, raw) => {
    const input = openAiImageApiSaveSchema.parse(raw);
    if (generation.hasPending && openAiImageApi.changesRequestCredentials(input)) {
      assertOpenAiImageApiMutable();
    }
    const result = openAiImageApi.save(input);
    await syncOpenAiImageApiRuntime();
    return result;
  });
  ipcMain.handle('openai-image-api:test', async () => {
    assertOpenAiImageApiMutable();
    const result = await openAiImageApi.test();
    await syncOpenAiImageApiRuntime();
    return result;
  });
  ipcMain.handle('openai-image-api:clear', async () => {
    assertOpenAiImageApiMutable();
    const result = openAiImageApi.clear();
    await syncOpenAiImageApiRuntime();
    return result;
  });
  const assertDeepSeekApiMutable = () => {
    if (codex.hasPending) throw new Error('Wait for active AI tasks before changing DeepSeek API configuration');
  };
  ipcMain.handle('deepseek-api:get', () => deepSeekApi.status());
  ipcMain.handle('deepseek-api:save', async (_event, raw) => {
    assertDeepSeekApiMutable();
    const result = await deepSeekApi.saveAndTest(deepSeekApiSaveSchema.parse(raw));
    await syncDeepSeekApiRuntime();
    return result;
  });
  ipcMain.handle('deepseek-api:test', async () => {
    assertDeepSeekApiMutable();
    const result = await deepSeekApi.test();
    await syncDeepSeekApiRuntime();
    return result;
  });
  ipcMain.handle('deepseek-api:clear', async () => {
    assertDeepSeekApiMutable();
    const result = deepSeekApi.clear();
    await syncDeepSeekApiRuntime();
    return result;
  });
  ipcMain.handle('antigravity-cli:get', () => generation.antigravityCliStatus ?? unavailableAntigravityStatus());
  ipcMain.handle('antigravity-cli:refresh', async () => {
    if (!generation.refreshAntigravityCli) return generation.antigravityCliStatus ?? unavailableAntigravityStatus();
    return await generation.refreshAntigravityCli();
  });
  const assistantRoutingSnapshot = async () => {
    const configuration = assistantRouting.get();
    const codexExtension = extensions.get(CODEX_APP_SERVER_EXTENSION_ID);
    let codexModels: CodexTextModelDto[] = [];
    if (codexExtension?.enabled && codexExtension.connectionState === 'READY') {
      try {
        codexModels = await codex.listModels();
      } catch {
        // The runtime-managed default remains usable when catalog discovery is temporarily unavailable.
      }
    }
    const antigravityStatus = generation.antigravityCliStatus;
    const antigravityModels: CodexTextModelDto[] = antigravityStatus
      ? [
          {
            key: ANTIGRAVITY_CLI_DEFAULT_MODEL_KEY,
            name: antigravityStatus.currentModel
              ? `CLI default · ${antigravityStatus.currentModel.name}`
              : 'CLI default',
            isDefault: true,
            defaultReasoningEffort: null,
            supportedReasoningEfforts: [],
          },
          ...antigravityStatus.models.map((model) => ({
            key: model.key,
            name: model.name,
            isDefault: false,
            defaultReasoningEffort: null,
            supportedReasoningEfforts: [],
          })),
        ]
      : [];
    return {
      ...configuration,
      models: ASSISTANT_MODEL_DEFINITIONS.map((model) => {
        const extension = extensions.get(model.extensionId);
        const ready = Boolean(extension?.enabled && extension.connectionState === 'READY');
        return {
          ...model,
          supportedOperations: [...model.supportedOperations],
          modelOptions:
            model.modelSelectionMode === 'CATALOG'
              ? model.providerKey === ANTIGRAVITY_CLI_PROVIDER_KEY
                ? antigravityModels
                : codexModels
              : [],
          state: ready ? ('READY' as const) : ('UNAVAILABLE' as const),
          availabilityReason: ready ? null : extension?.connectionMessage || 'Provider extension unavailable',
        };
      }),
    };
  };
  ipcMain.handle('assistant-routing:get', assistantRoutingSnapshot);
  ipcMain.handle('assistant-routing:save', async (_event, raw) => {
    assistantRouting.save(assistantRoutingSaveSchema.parse(raw));
    return await assistantRoutingSnapshot();
  });
  ipcMain.handle('image-generation-concurrency:save', async (_event, raw) => {
    const input = generationConcurrencySaveSchema.parse(raw);
    if (!generation.imageGenerationRoutes.some((route) => route.key === input.modelKey)) {
      throw new Error(`Unknown image-generation model: ${input.modelKey}`);
    }
    const configuration = generationConcurrency.save(input);
    await generation.configureConcurrency?.(configuration);
    return configuration;
  });
  const assertExternalImageApiMutable = (extensionId: (typeof EXTERNAL_IMAGE_API_EXTENSION_IDS)[number]) => {
    if (hasPendingImageConnection(externalImageConnectionId(extensionId))) {
      throw new Error('Wait for active tasks using this image API connection before changing its configuration');
    }
  };
  ipcMain.handle('external-image-api:get', (_event, rawExtensionId) =>
    externalImageApis.status(externalImageApiExtensionIdSchema.parse(rawExtensionId)),
  );
  ipcMain.handle('external-image-api:save', async (_event, raw) => {
    const input = externalImageApiSaveSchema.parse(raw);
    assertExternalImageApiMutable(input.extensionId);
    const endpointPermission = externalImageApiEndpointPermission(input.extensionId, input.settings);
    if (endpointPermission && !extensions.isPermissionGranted(input.extensionId, endpointPermission)) {
      throw new Error(`Grant extension permission ${endpointPermission} before saving this endpoint`);
    }
    const result = await externalImageApis.saveAndTest(input);
    await syncExternalImageApiRuntime();
    return result;
  });
  ipcMain.handle('external-image-api:test', async (_event, rawExtensionId) => {
    const extensionId = externalImageApiExtensionIdSchema.parse(rawExtensionId);
    assertExternalImageApiMutable(extensionId);
    const result = await externalImageApis.test(extensionId);
    await syncExternalImageApiRuntime();
    return result;
  });
  ipcMain.handle('external-image-api:clear', async (_event, rawExtensionId) => {
    const extensionId = externalImageApiExtensionIdSchema.parse(rawExtensionId);
    assertExternalImageApiMutable(extensionId);
    const result = externalImageApis.clear(extensionId);
    await syncExternalImageApiRuntime();
    return result;
  });
}
