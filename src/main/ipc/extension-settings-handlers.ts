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
import type { CodexHistorySearch } from '@/main/extensions/codex-history-search';
import type { CodexVisualizationDiscovery } from '@/main/extensions/codex-visualization-discovery';
import type { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import type { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import type { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { NaturalWatermarkConfigurationStore } from '@/main/extensions/natural-watermark/configuration';
import type { NaturalWatermarkService } from '@/main/extensions/natural-watermark/service';
import type { GenerationConcurrencyConfiguration } from '@/main/generation/concurrency-configuration';
import type { GenerationService } from '@/main/generation/service';
import { CODEX_HISTORY_SEARCH_PERMISSIONS } from '@/main/extensions/host-runtime-contracts';
import {
  assistantRoutingSaveSchema,
  codexGeneratedImageImportSchema,
  codexGeneratedImageListSchema,
  codexGeneratedImageRecoverSchema,
  extensionSetEnabledSchema,
  extensionSetPermissionSchema,
  generationConcurrencySaveSchema,
  id,
} from '@/main/ipc/schemas';
import { registerProviderConnectionIpc } from '@/main/ipc/provider-connection-handlers';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { registerCodexUsageIpc } from '@/main/ipc/codex-usage-handlers';
import { registerCodexHistorySearchIpc } from '@/main/ipc/codex-history-search-handlers';
import { registerCodexVisualizationIpc } from '@/main/ipc/codex-visualization-handlers';
import type { AntigravityCliStatusDto, CodexTextModelDto } from '@/shared/contracts';
import {
  naturalWatermarkConfigurationSchema,
  naturalWatermarkCustomLogoIdSchema,
} from '@/shared/contracts/natural-watermark';
import {
  ANTIGRAVITY_CLI_DEFAULT_MODEL_KEY,
  ANTIGRAVITY_CLI_EXTENSION_ID,
  ANTIGRAVITY_CLI_PROVIDER_KEY,
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_EXTENSION_ID,
  CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  NATURAL_WATERMARK_EXTENSION_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';

const externalImageApiExtensionIds = new Set<string>(EXTERNAL_IMAGE_API_EXTENSION_IDS);

interface ExtensionSettingsIpcOptions {
  ipcMain: IpcHandlerRegistrar;
  extensions: ExtensionRegistry;
  codexImageDiscovery: CodexImageDiscovery;
  codexHistorySearch: CodexHistorySearch;
  codexVisualizationDiscovery: CodexVisualizationDiscovery;
  openAiImageApi: OpenAiImageApiConnection;
  deepSeekApi: DeepSeekApiConnection;
  assistantRouting: AssistantRoutingConfiguration;
  externalImageApis: ExternalImageApiConnections;
  generation: GenerationService;
  generationConcurrency: GenerationConcurrencyConfiguration;
  naturalWatermarkConfiguration: NaturalWatermarkConfigurationStore;
  naturalWatermarkService: NaturalWatermarkService;
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
    if (!extensions.isActivated(CODEX_EXTENSION_ID)) {
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

function unavailableAntigravityStatus(): AntigravityCliStatusDto {
  return {
    state: 'unavailable',
    version: '',
    authenticated: false,
    message: 'Background model service is unavailable',
    currentModel: null,
    models: [],
    quota: { warning: 'UNAVAILABLE', groups: [], checkedAt: null, message: 'Quota is unavailable' },
  };
}

export function registerExtensionSettingsIpc({
  ipcMain,
  extensions,
  codexImageDiscovery,
  codexHistorySearch,
  codexVisualizationDiscovery,
  openAiImageApi,
  deepSeekApi,
  assistantRouting,
  externalImageApis,
  generation,
  generationConcurrency,
  naturalWatermarkConfiguration,
  naturalWatermarkService,
  codex,
  chooseFile,
  chooseSaveFile,
  sendRendererEvent,
}: ExtensionSettingsIpcOptions) {
  const syncExternalImageApiRuntime = async () => {
    await generation.configureExternalImageApis?.(
      externalImageApis.runtimeConfigurations(
        (extensionId, permission) => extensions.isPermissionGranted(extensionId, permission),
        (extensionId) => extensions.isActivated(extensionId),
      ),
    );
  };
  const syncOpenAiImageApiRuntime = async () => {
    await generation.configureOpenAiImageApi?.(
      extensions.isActivated(OPENAI_IMAGE_API_EXTENSION_ID) ? openAiImageApi.runtimeConfiguration() : null,
    );
  };
  const syncDeepSeekApiRuntime = async () => {
    await generation.configureDeepSeekApi?.(
      extensions.isActivated(DEEPSEEK_API_EXTENSION_ID) ? deepSeekApi.runtimeConfiguration() : null,
    );
  };
  ipcMain.handle('extensions:list', () => extensions.list());
  ipcMain.handle('natural-watermark:configuration-get', () => naturalWatermarkConfiguration.get());
  ipcMain.handle('natural-watermark:configuration-save', async (_event, raw) => {
    const configuration = naturalWatermarkConfigurationSchema.parse(raw);
    const customLogoIds = new Set(
      configuration.profiles.flatMap(({ logo }) => (logo.kind === 'CUSTOM' ? [logo.id] : [])),
    );
    await Promise.all([...customLogoIds].map((customLogoId) => naturalWatermarkService.customLogo(customLogoId)));
    return naturalWatermarkConfiguration.save(configuration);
  });
  ipcMain.handle('natural-watermark:custom-logo-get', (_event, rawId) =>
    naturalWatermarkService.customLogo(naturalWatermarkCustomLogoIdSchema.parse(rawId)),
  );
  ipcMain.handle('natural-watermark:preview-image-get', () => naturalWatermarkService.previewImage());
  ipcMain.handle('natural-watermark:custom-logo-import', async () => {
    if (!extensions.isActivated(NATURAL_WATERMARK_EXTENSION_ID)) {
      throw new Error('Natural Watermark is disabled or missing permissions');
    }
    const selection = await chooseFile({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    });
    if (selection.canceled) return null;
    const selectedPath = selection.filePaths[0];
    if (!selectedPath) throw new Error('No custom watermark logo was selected');
    return naturalWatermarkService.importCustomLogo(selectedPath);
  });
  ipcMain.handle('natural-watermark:preview-image-import', async () => {
    if (!extensions.isActivated(NATURAL_WATERMARK_EXTENSION_ID)) {
      throw new Error('Natural Watermark is disabled or missing permissions');
    }
    const selection = await chooseFile({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selection.canceled) return null;
    const selectedPath = selection.filePaths[0];
    if (!selectedPath) throw new Error('No watermark preview image was selected');
    return naturalWatermarkService.importPreviewImage(selectedPath);
  });
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
    (extensionId === CODEX_EXTENSION_ID && (codexUsage.hasPending || codexVisualizationDiscovery.hasPending));
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
  const syncCodexImageDiscovery = () => codexImageDiscovery.setActive(extensions.isActivated(CODEX_EXTENSION_ID));
  const syncCodexHistorySearch = () => codexHistorySearch.setActive(extensions.isActivated(CODEX_EXTENSION_ID));
  const syncCodexVisualizationDiscovery = () =>
    codexVisualizationDiscovery.setActive(extensions.isActivated(CODEX_EXTENSION_ID));
  const syncExtensionRuntime = async (extensionId: string) => {
    if (extensionId === CODEX_EXTENSION_ID) {
      syncCodexHistorySearch();
      await syncCodexImageDiscovery();
      syncCodexVisualizationDiscovery();
      await generation.refreshExtensions?.();
      return;
    }
    if (extensionId === ANTIGRAVITY_CLI_EXTENSION_ID) {
      await generation.refreshExtensions?.();
      return;
    }
    if (extensionId === OPENAI_IMAGE_API_EXTENSION_ID) {
      await syncOpenAiImageApiRuntime();
      return;
    }
    if (extensionId === DEEPSEEK_API_EXTENSION_ID) {
      await syncDeepSeekApiRuntime();
      return;
    }
    if (externalImageApiExtensionIds.has(extensionId)) {
      await syncExternalImageApiRuntime();
    }
  };
  ipcMain.handle('extension:set-enabled', async (_event, raw) => {
    const input = extensionSetEnabledSchema.parse(raw);
    if (!input.enabled && hasPendingExtensionWork(input.extensionId)) {
      throw new Error('Wait for active model tasks to finish before disabling an extension');
    }
    extensions.setEnabled(input.extensionId, input.enabled);
    await syncExtensionRuntime(input.extensionId);
    return extensions.list();
  });
  ipcMain.handle('extension:set-permission', async (_event, raw) => {
    const input = extensionSetPermissionSchema.parse(raw);
    if (!input.granted && hasPendingExtensionWork(input.extensionId)) {
      throw new Error('Wait for active model tasks to finish before revoking a permission');
    }
    extensions.setPermission(input.extensionId, input.permission, input.granted);
    await syncExtensionRuntime(input.extensionId);
    if (
      input.extensionId === CODEX_EXTENSION_ID &&
      !input.granted &&
      CODEX_HISTORY_SEARCH_PERMISSIONS.some((permission) => permission === input.permission)
    ) {
      await codexHistorySearch.purge();
    }
    return extensions.list();
  });
  registerCodexImageDiscoveryIpc(ipcMain, extensions, codexImageDiscovery);
  registerCodexHistorySearchIpc(ipcMain, extensions, codexHistorySearch);
  registerCodexVisualizationIpc(ipcMain, extensions, codexVisualizationDiscovery, chooseFile, chooseSaveFile);
  registerProviderConnectionIpc({
    ipcMain,
    extensions,
    openAiImageApi,
    deepSeekApi,
    externalImageApis,
    generation,
    codex,
  });
  ipcMain.handle('antigravity-cli:get', () => generation.antigravityCliStatus ?? unavailableAntigravityStatus());
  ipcMain.handle('antigravity-cli:refresh', async () => {
    if (!extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID)) {
      throw new Error('Antigravity CLI extension is disabled or missing permissions');
    }
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
}
