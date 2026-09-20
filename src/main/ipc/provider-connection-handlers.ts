import type { CodexService } from '@/main/assistant/codex-service';
import { DEEPSEEK_PROVIDER_KEY } from '@/main/assistant-models/deepseek-provider';
import type { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import type { CpaImageConnection } from '@/main/extensions/cpa-image/connection';
import { appendCpaImageRuntimeConfiguration } from '@/main/extensions/cpa-image/integration';
import {
  CPA_IMAGE_DEFAULT_BASE_URL,
  cpaImageEndpointPermission,
  validatedCpaImageBaseUrl,
} from '@/main/extensions/cpa-image/endpoint';
import {
  DEEPSEEK_VISION_ENDPOINT_PERMISSION,
  deepSeekVisionEndpointPermission,
  validatedDeepSeekVisionSettings,
} from '@/main/extensions/deepseek-api/vision-endpoint';
import {
  USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION,
  externalImageApiEndpointPermission,
  type ExternalImageApiConnections,
} from '@/main/extensions/external-image-api';
import type { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import { ProviderConnectionRegistry } from '@/main/extensions/provider-connection-registry';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { GenerationService } from '@/main/generation/service';
import { deepSeekApiSaveSchema, externalImageApiSaveSchema, openAiImageApiSaveSchema } from '@/main/ipc/schemas';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type {
  DeepSeekApiConnectionDto,
  ExternalImageApiConnectionDto,
  OpenAiImageApiConnectionDto,
  ProviderConnectionDto,
  ProviderConnectionSaveInput,
} from '@/shared/contracts';
import {
  providerConnectionSaveInputSchema,
  providerConnectionTargetInputSchema,
} from '@/shared/contracts/provider-connections';
import {
  DEEPSEEK_API_CONNECTION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  CPA_IMAGE_API_EXTENSION_ID,
  CPA_IMAGE_CONNECTION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  OPENAI_IMAGE_API_EXTENSION_ID,
  OPENAI_IMAGE_CONNECTION_ID,
  externalImageConnectionId,
} from '@/shared/extension-ids';
import { resolveImageGenerationRouteExecutionIdentity } from '@/shared/image-generation-route-identity';
import { EXTENSION_PERMISSION_TEMPLATE } from '@/shared/extension-permissions';

interface ProviderConnectionIpcOptions {
  ipcMain: IpcHandlerRegistrar;
  extensions: ExtensionRegistry;
  openAiImageApi: OpenAiImageApiConnection;
  deepSeekApi: DeepSeekApiConnection;
  externalImageApis: ExternalImageApiConnections;
  cpaImageApi: CpaImageConnection;
  generation: GenerationService;
  codex: CodexService;
}

const providerConnectionActions: ProviderConnectionDto['supportedActions'] = ['SAVE', 'VERIFY', 'REMOVE'];

function openAiProviderConnection(connection: OpenAiImageApiConnectionDto): ProviderConnectionDto {
  return {
    connectionId: connection.connectionId,
    providerId: connection.providerId,
    extensionId: OPENAI_IMAGE_API_EXTENSION_ID,
    kind: 'REMOTE_API',
    configured: connection.configured,
    connectionState: connection.status,
    message: connection.message,
    credentialHint: connection.apiKeyHint,
    modelId: connection.modelId,
    settings: {
      organizationId: connection.organizationId,
      projectId: connection.projectId,
      moderation: connection.moderation,
    },
    supportedActions: [...providerConnectionActions],
    updatedAt: connection.updatedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
  };
}

function deepSeekProviderConnection(connection: DeepSeekApiConnectionDto): ProviderConnectionDto {
  return {
    connectionId: DEEPSEEK_API_CONNECTION_ID,
    providerId: DEEPSEEK_PROVIDER_KEY,
    extensionId: DEEPSEEK_API_EXTENSION_ID,
    kind: 'REMOTE_API',
    configured: connection.configured,
    connectionState: connection.status,
    message: connection.message,
    credentialHint: connection.apiKeyHint,
    modelId: connection.modelId,
    settings: {
      visionEndpoint: connection.visionEndpoint,
      visionModelId: connection.visionModelId,
    },
    supportedActions: [...providerConnectionActions],
    updatedAt: connection.updatedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
  };
}

function externalProviderConnection(connection: ExternalImageApiConnectionDto): ProviderConnectionDto {
  return {
    connectionId: connection.connectionId,
    providerId: connection.providerId,
    extensionId: connection.extensionId,
    kind: 'REMOTE_API',
    configured: connection.configured,
    connectionState: connection.status,
    message: connection.message,
    credentialHint: connection.apiKeyHint,
    modelId: connection.modelId,
    settings: connection.settings,
    supportedActions: [...providerConnectionActions],
    updatedAt: connection.updatedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
  };
}

function authorizeEndpointPermission(
  extensions: ExtensionRegistry,
  extensionId: string,
  template: string,
  permission: string | null,
) {
  if (!permission) return { permission: null, newlyGranted: false };
  if (extensions.declaresPermission(extensionId, permission)) {
    if (extensions.isPermissionGranted(extensionId, permission)) {
      return { permission, newlyGranted: false };
    }
    throw new Error(`Grant extension permission ${permission} before saving this endpoint`);
  }
  return {
    permission,
    newlyGranted: extensions.grantRuntimePermission(extensionId, template, permission),
  };
}

function assertExtensionActivated(extensions: ExtensionRegistry, extensionId: string) {
  if (!extensions.isActivated(extensionId)) {
    throw new Error(`Extension ${extensionId} is disabled or missing required permissions`);
  }
}

function assertEndpointPermissionGranted(
  extensions: ExtensionRegistry,
  extensionId: string,
  permission: string | null,
) {
  if (permission && !extensions.isPermissionGranted(extensionId, permission)) {
    throw new Error(`Grant extension permission ${permission} before contacting this endpoint`);
  }
}

export function registerProviderConnectionIpc({
  ipcMain,
  extensions,
  openAiImageApi,
  deepSeekApi,
  externalImageApis,
  cpaImageApi,
  generation,
  codex,
}: ProviderConnectionIpcOptions) {
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
  const syncExternalImageApiRuntime = async () => {
    const configured = externalImageApis.runtimeConfigurations(
      (extensionId, permission) => extensions.isPermissionGranted(extensionId, permission),
      (extensionId) => extensions.isActivated(extensionId),
    );
    await generation.configureExternalImageApis?.(
      appendCpaImageRuntimeConfiguration(configured, cpaImageApi, extensions),
    );
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
  const assertDeepSeekApiMutable = () => {
    if (codex.hasPending) throw new Error('Wait for active AI tasks before changing DeepSeek API configuration');
  };
  const assertExternalImageApiMutable = (extensionId: (typeof EXTERNAL_IMAGE_API_EXTENSION_IDS)[number]) => {
    if (hasPendingImageConnection(externalImageConnectionId(extensionId))) {
      throw new Error('Wait for active tasks using this image API connection before changing its configuration');
    }
  };

  const providerConnections = new ProviderConnectionRegistry([
    {
      connectionId: OPENAI_IMAGE_CONNECTION_ID,
      snapshot: () => openAiProviderConnection(openAiImageApi.status()),
      save: async (input: ProviderConnectionSaveInput) => {
        const settings = openAiImageApiSaveSchema.parse({ ...input.settings, apiKey: input.apiKey });
        if (generation.hasPending && openAiImageApi.changesRequestCredentials(settings)) {
          assertOpenAiImageApiMutable();
        }
        const result = openAiImageApi.save(settings);
        await syncOpenAiImageApiRuntime();
        return openAiProviderConnection(result);
      },
      verify: async () => {
        assertOpenAiImageApiMutable();
        assertExtensionActivated(extensions, OPENAI_IMAGE_API_EXTENSION_ID);
        const result = await openAiImageApi.test();
        await syncOpenAiImageApiRuntime();
        return openAiProviderConnection(result);
      },
      remove: async () => {
        assertOpenAiImageApiMutable();
        const result = openAiImageApi.clear();
        await syncOpenAiImageApiRuntime();
        return openAiProviderConnection(result);
      },
    },
    {
      connectionId: DEEPSEEK_API_CONNECTION_ID,
      snapshot: () => deepSeekProviderConnection(deepSeekApi.status()),
      save: async (input: ProviderConnectionSaveInput) => {
        assertDeepSeekApiMutable();
        assertExtensionActivated(extensions, DEEPSEEK_API_EXTENSION_ID);
        const settings = deepSeekApiSaveSchema.parse({ ...input.settings, apiKey: input.apiKey });
        const vision = validatedDeepSeekVisionSettings(settings.visionEndpoint, settings.visionModelId);
        const authorization = authorizeEndpointPermission(
          extensions,
          DEEPSEEK_API_EXTENSION_ID,
          DEEPSEEK_VISION_ENDPOINT_PERMISSION,
          deepSeekVisionEndpointPermission(vision.visionEndpoint),
        );
        let result;
        try {
          result = await deepSeekApi.saveAndTest(settings);
        } catch (reason) {
          if (authorization.permission && authorization.newlyGranted) {
            extensions.setPermission(DEEPSEEK_API_EXTENSION_ID, authorization.permission, false);
          }
          throw reason;
        }
        extensions.revokeRuntimePermissionsExcept(
          DEEPSEEK_API_EXTENSION_ID,
          DEEPSEEK_VISION_ENDPOINT_PERMISSION,
          authorization.permission,
        );
        await syncDeepSeekApiRuntime();
        return deepSeekProviderConnection(result);
      },
      verify: async () => {
        assertDeepSeekApiMutable();
        assertExtensionActivated(extensions, DEEPSEEK_API_EXTENSION_ID);
        const result = await deepSeekApi.test();
        await syncDeepSeekApiRuntime();
        return deepSeekProviderConnection(result);
      },
      remove: async () => {
        assertDeepSeekApiMutable();
        const result = deepSeekApi.clear();
        extensions.revokeRuntimePermissionsExcept(DEEPSEEK_API_EXTENSION_ID, DEEPSEEK_VISION_ENDPOINT_PERMISSION, null);
        await syncDeepSeekApiRuntime();
        return deepSeekProviderConnection(result);
      },
    },
    ...EXTERNAL_IMAGE_API_EXTENSION_IDS.map((extensionId) => ({
      connectionId: externalImageConnectionId(extensionId),
      snapshot: () => externalProviderConnection(externalImageApis.status(extensionId)),
      save: async (input: ProviderConnectionSaveInput) => {
        const settings = externalImageApiSaveSchema.parse({
          extensionId,
          apiKey: input.apiKey,
          settings: input.settings,
        });
        assertExternalImageApiMutable(extensionId);
        assertExtensionActivated(extensions, extensionId);
        const endpointPermission = externalImageApiEndpointPermission(extensionId, settings.settings);
        const authorization = authorizeEndpointPermission(
          extensions,
          extensionId,
          USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION,
          endpointPermission,
        );
        let result;
        try {
          result = await externalImageApis.saveAndTest(settings);
        } catch (reason) {
          if (authorization.permission && authorization.newlyGranted) {
            extensions.setPermission(extensionId, authorization.permission, false);
          }
          throw reason;
        }
        extensions.revokeRuntimePermissionsExcept(
          extensionId,
          USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION,
          authorization.permission,
        );
        await syncExternalImageApiRuntime();
        return externalProviderConnection(result);
      },
      verify: async () => {
        assertExternalImageApiMutable(extensionId);
        assertExtensionActivated(extensions, extensionId);
        assertEndpointPermissionGranted(extensions, extensionId, externalImageApis.endpointPermission(extensionId));
        const result = await externalImageApis.test(extensionId);
        await syncExternalImageApiRuntime();
        return externalProviderConnection(result);
      },
      remove: async () => {
        assertExternalImageApiMutable(extensionId);
        const result = externalImageApis.clear(extensionId);
        extensions.revokeRuntimePermissionsExcept(extensionId, USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION, null);
        await syncExternalImageApiRuntime();
        return externalProviderConnection(result);
      },
    })),
    {
      connectionId: CPA_IMAGE_CONNECTION_ID,
      snapshot: () => cpaImageApi.status(),
      save: async (input: ProviderConnectionSaveInput) => {
        if (hasPendingImageConnection(CPA_IMAGE_CONNECTION_ID)) {
          throw new Error('Wait for active CPA image tasks before changing its configuration');
        }
        assertExtensionActivated(extensions, CPA_IMAGE_API_EXTENSION_ID);
        const baseUrl = validatedCpaImageBaseUrl(input.settings.baseUrl ?? CPA_IMAGE_DEFAULT_BASE_URL);
        const authorization = authorizeEndpointPermission(
          extensions,
          CPA_IMAGE_API_EXTENSION_ID,
          EXTENSION_PERMISSION_TEMPLATE.userConfiguredCpaEndpoint,
          cpaImageEndpointPermission(baseUrl),
        );
        let result;
        try {
          result = await cpaImageApi.save({ ...input, settings: { baseUrl } });
        } catch (reason) {
          if (authorization.permission && authorization.newlyGranted) {
            extensions.setPermission(CPA_IMAGE_API_EXTENSION_ID, authorization.permission, false);
          }
          throw reason;
        }
        extensions.revokeRuntimePermissionsExcept(
          CPA_IMAGE_API_EXTENSION_ID,
          EXTENSION_PERMISSION_TEMPLATE.userConfiguredCpaEndpoint,
          authorization.permission,
        );
        await syncExternalImageApiRuntime();
        return result;
      },
      verify: async () => {
        assertExtensionActivated(extensions, CPA_IMAGE_API_EXTENSION_ID);
        assertEndpointPermissionGranted(extensions, CPA_IMAGE_API_EXTENSION_ID, cpaImageApi.endpointPermission());
        const result = await cpaImageApi.verify();
        await syncExternalImageApiRuntime();
        return result;
      },
      remove: async () => {
        if (hasPendingImageConnection(CPA_IMAGE_CONNECTION_ID)) {
          throw new Error('Wait for active CPA image tasks before clearing its configuration');
        }
        const result = await cpaImageApi.remove();
        extensions.revokeRuntimePermissionsExcept(
          CPA_IMAGE_API_EXTENSION_ID,
          EXTENSION_PERMISSION_TEMPLATE.userConfiguredCpaEndpoint,
          null,
        );
        await syncExternalImageApiRuntime();
        return result;
      },
    },
  ]);

  ipcMain.handle('provider-connections:list', () => providerConnections.list());
  ipcMain.handle('provider-connection:save', (_event, raw) =>
    providerConnections.save(providerConnectionSaveInputSchema.parse(raw)),
  );
  ipcMain.handle('provider-connection:verify', (_event, raw) =>
    providerConnections.verify(providerConnectionTargetInputSchema.parse(raw).connectionId),
  );
  ipcMain.handle('provider-connection:remove', (_event, raw) =>
    providerConnections.remove(providerConnectionTargetInputSchema.parse(raw).connectionId),
  );
}
