import type { ExtensionImageApiConfigurationDto } from '@/shared/contracts';
import { EXTENSION_PERMISSION_TEMPLATE, networkOriginExtensionPermission } from '@/shared/extension-permissions';
import {
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
  type ExternalImageApiExtensionId,
} from '@/shared/extension-ids';

export const CUSTOM_ENDPOINT_PRESET_ID = 'custom';
export const USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION = EXTENSION_PERMISSION_TEMPLATE.userConfiguredHttpsEndpoint;
export const BYTEPLUS_AP_ENDPOINT_PERMISSION = 'network:https://ark.ap-southeast.bytepluses.com';
export const BYTEPLUS_EU_ENDPOINT_PERMISSION = 'network:https://ark.eu-west.bytepluses.com';
export const GOOGLE_GEMINI_DEFAULT_MODEL_ID = 'gemini-3.1-flash-image';
export const ALIBABA_QWEN_DEFAULT_MODEL_ID = 'qwen-image-3.0-pro';
export const VOLCENGINE_SEEDREAM_DEFAULT_MODEL_ID = 'doubao-seedream-5-0-260128';
export const BYTEPLUS_SEEDREAM_DEFAULT_MODEL_ID = 'dola-seedream-5-0-pro-260628';

const configurations = {
  [GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID]: {
    kind: 'IMAGE_API',
    defaultEndpointPresetId: 'google-global',
    endpointPresets: [
      {
        id: 'google-global',
        endpointTemplate: 'https://generativelanguage.googleapis.com/v1beta/interactions',
        modelId: GOOGLE_GEMINI_DEFAULT_MODEL_ID,
      },
    ],
    settingFields: [],
    customEndpointAllowed: true,
    customModelIdAllowed: true,
    connectionCheckPresetIds: ['google-global'],
  },
  [ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID]: {
    kind: 'IMAGE_API',
    defaultEndpointPresetId: 'alibaba-cn-beijing',
    endpointPresets: [
      {
        id: 'alibaba-cn-beijing',
        endpointTemplate:
          'https://{workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        modelId: ALIBABA_QWEN_DEFAULT_MODEL_ID,
      },
      {
        id: 'alibaba-singapore',
        endpointTemplate:
          'https://{workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        modelId: ALIBABA_QWEN_DEFAULT_MODEL_ID,
      },
    ],
    settingFields: [
      {
        key: 'workspaceId',
        required: true,
        endpointPresetIds: ['alibaba-cn-beijing', 'alibaba-singapore'],
      },
    ],
    customEndpointAllowed: true,
    customModelIdAllowed: true,
    connectionCheckPresetIds: [],
  },
  [VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID]: {
    kind: 'IMAGE_API',
    defaultEndpointPresetId: 'volcengine-cn-beijing',
    endpointPresets: [
      {
        id: 'volcengine-cn-beijing',
        endpointTemplate: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
        modelId: VOLCENGINE_SEEDREAM_DEFAULT_MODEL_ID,
      },
      {
        id: 'byteplus-ap-southeast-1',
        endpointTemplate: 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations',
        modelId: BYTEPLUS_SEEDREAM_DEFAULT_MODEL_ID,
      },
      {
        id: 'byteplus-eu-west-1',
        endpointTemplate: 'https://ark.eu-west.bytepluses.com/api/v3/images/generations',
        modelId: BYTEPLUS_SEEDREAM_DEFAULT_MODEL_ID,
      },
    ],
    settingFields: [],
    customEndpointAllowed: true,
    customModelIdAllowed: true,
    connectionCheckPresetIds: [],
  },
} satisfies Record<ExternalImageApiExtensionId, ExtensionImageApiConfigurationDto>;

export interface ResolvedExternalImageApiEndpoint {
  endpointPresetId: string;
  endpoint: string;
  modelId: string;
  custom: boolean;
}

export function externalImageApiConfiguration(extensionId: ExternalImageApiExtensionId) {
  return configurations[extensionId] as ExtensionImageApiConfigurationDto;
}

export function defaultExternalImageApiSettings(extensionId: ExternalImageApiExtensionId) {
  const configuration = externalImageApiConfiguration(extensionId);
  const preset = configuration.endpointPresets.find(
    (candidate) => candidate.id === configuration.defaultEndpointPresetId,
  )!;
  return {
    endpointPresetId: preset.id,
    customEndpoint: '',
    modelId: preset.modelId,
    ...Object.fromEntries(configuration.settingFields.map((field) => [field.key, ''])),
  };
}

export function externalImageApiSettingsWithDefaults(
  extensionId: ExternalImageApiExtensionId,
  settings: Record<string, string>,
) {
  const defaults = defaultExternalImageApiSettings(extensionId);
  return {
    ...defaults,
    ...settings,
    endpointPresetId: settings.endpointPresetId || defaults.endpointPresetId,
  };
}

function validatedSetting(value: unknown, field: string, required: boolean) {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${field} is required`);
  if (normalized.length > 200 || /[\r\n]/.test(normalized)) throw new Error(`${field} is invalid`);
  if (field === 'workspaceId' && normalized && !/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error('Workspace ID is invalid');
  }
  return normalized;
}

function validatedModelId(value: unknown) {
  const modelId = validatedSetting(value, 'Model ID', true);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(modelId)) throw new Error('Model ID is invalid');
  return modelId;
}

export function validatedCustomHttpsEndpoint(value: unknown) {
  const raw = validatedSetting(value, 'Custom endpoint', true);
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error('Custom endpoint is invalid');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname === '/'
  ) {
    throw new Error('Custom endpoint must be a credential-free HTTPS request URL');
  }
  return endpoint.toString();
}

export function normalizeExternalImageApiSettings(
  extensionId: ExternalImageApiExtensionId,
  rawSettings: Record<string, string>,
) {
  const configuration = externalImageApiConfiguration(extensionId);
  const settings: Record<string, string> = externalImageApiSettingsWithDefaults(extensionId, rawSettings);
  const endpointPresetId = validatedSetting(settings.endpointPresetId, 'Endpoint', true);
  const custom = endpointPresetId === CUSTOM_ENDPOINT_PRESET_ID;
  const preset = configuration.endpointPresets.find((candidate) => candidate.id === endpointPresetId);
  if (!custom && !preset) throw new Error('Unsupported provider endpoint');
  if (custom && !configuration.customEndpointAllowed) throw new Error('Custom endpoints are not supported');

  const normalized: Record<string, string> = {
    endpointPresetId,
    customEndpoint: custom
      ? validatedCustomHttpsEndpoint(settings.customEndpoint)
      : validatedSetting(settings.customEndpoint, 'Custom endpoint', false),
    modelId: custom ? validatedModelId(settings.modelId) : preset!.modelId,
  };
  for (const field of configuration.settingFields) {
    const active = field.endpointPresetIds.includes(endpointPresetId);
    normalized[field.key] = validatedSetting(settings[field.key], field.key, active && field.required);
  }
  return normalized;
}

/** Connection fields exclude the independently selected provider model. */
export function externalImageApiConnectionSettings(
  extensionId: ExternalImageApiExtensionId,
  rawSettings: Record<string, string>,
) {
  const { modelId: _modelId, ...connectionSettings } = normalizeExternalImageApiSettings(extensionId, rawSettings);
  return connectionSettings;
}

export function externalImageApiModelId(extensionId: ExternalImageApiExtensionId, rawSettings: Record<string, string>) {
  return normalizeExternalImageApiSettings(extensionId, rawSettings).modelId;
}

export function resolveExternalImageApiEndpoint(
  extensionId: ExternalImageApiExtensionId,
  rawSettings: Record<string, string>,
): ResolvedExternalImageApiEndpoint {
  const settings = normalizeExternalImageApiSettings(extensionId, rawSettings);
  if (settings.endpointPresetId === CUSTOM_ENDPOINT_PRESET_ID) {
    return {
      endpointPresetId: settings.endpointPresetId,
      endpoint: settings.customEndpoint,
      modelId: settings.modelId,
      custom: true,
    };
  }
  const configuration = externalImageApiConfiguration(extensionId);
  const preset = configuration.endpointPresets.find((candidate) => candidate.id === settings.endpointPresetId)!;
  const endpoint = preset.endpointTemplate.replace(/\{([A-Za-z0-9._-]+)\}/g, (_match, key: string) => {
    const value = settings[key];
    if (!value) throw new Error(`${key} is required`);
    return value;
  });
  return {
    endpointPresetId: preset.id,
    endpoint,
    modelId: preset.modelId,
    custom: false,
  };
}

/** Optional authority required by endpoint choices outside the plugin's default network scope. */
export function externalImageApiEndpointPermission(
  extensionId: ExternalImageApiExtensionId,
  rawSettings: Record<string, string>,
) {
  const resolved = resolveExternalImageApiEndpoint(extensionId, rawSettings);
  if (resolved.custom) return networkOriginExtensionPermission(resolved.endpoint);
  if (extensionId === ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID) {
    return networkOriginExtensionPermission(resolved.endpoint);
  }
  if (extensionId !== VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID) return null;
  if (resolved.endpointPresetId === 'byteplus-ap-southeast-1') return BYTEPLUS_AP_ENDPOINT_PERMISSION;
  if (resolved.endpointPresetId === 'byteplus-eu-west-1') return BYTEPLUS_EU_ENDPOINT_PERMISSION;
  return null;
}
