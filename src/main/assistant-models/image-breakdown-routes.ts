import type { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import {
  deepSeekVisionEndpointPermission,
  DEEPSEEK_VISION_REFERENCE_PERMISSION,
} from '@/main/extensions/deepseek-api/vision-endpoint';
import type { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { AntigravityCliStatusDto } from '@/shared/contracts';
import { imageBreakdownRoutesSchema, type ImageBreakdownRouteDto } from '@/shared/contracts/image-breakdown';
import {
  ANTIGRAVITY_CLI_DEFAULT_MODEL_KEY,
  ANTIGRAVITY_CLI_EXTENSION_ID,
  ANTIGRAVITY_CLI_PROVIDER_KEY,
  DEEPSEEK_API_EXTENSION_ID,
  GOOGLE_GEMINI_API_EXTENSION_ID,
  GOOGLE_GEMINI_ASSISTANT_MODEL_KEY,
} from '@/shared/extension-ids';

function routeState(activated: boolean, ready: boolean, message: string) {
  return activated && ready
    ? ({ state: 'READY', availabilityReason: null } as const)
    : ({
        state: 'UNAVAILABLE',
        availabilityReason: activated ? message : 'Extension is disabled or missing required permissions',
      } as const);
}

function routeId(key: ImageBreakdownRouteDto['key'], modelKey: string) {
  return `${key}:${modelKey}`;
}

function antigravityRoutes(
  extensions: ExtensionRegistry,
  status: AntigravityCliStatusDto | undefined,
): ImageBreakdownRouteDto[] {
  const activated = extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID);
  const geminiModels = (status?.models ?? [])
    .filter((model) => /^gemini-/i.test(model.key))
    .sort(
      (left, right) =>
        Number(right.isCurrent) - Number(left.isCurrent) ||
        left.name.localeCompare(right.name) ||
        left.key.localeCompare(right.key),
    );
  if (activated && status?.state === 'ready' && geminiModels.length > 0) {
    return geminiModels.map((model) => ({
      id: routeId('ANTIGRAVITY_CLI', model.key),
      key: 'ANTIGRAVITY_CLI',
      providerKey: ANTIGRAVITY_CLI_PROVIDER_KEY,
      modelKey: model.key,
      extensionId: ANTIGRAVITY_CLI_EXTENSION_ID,
      name: `${model.name} · Agent`,
      state: 'READY',
      availabilityReason: null,
    }));
  }
  const modelKey = status?.currentModel?.key || ANTIGRAVITY_CLI_DEFAULT_MODEL_KEY;
  return [
    {
      id: routeId('ANTIGRAVITY_CLI', modelKey),
      key: 'ANTIGRAVITY_CLI',
      providerKey: ANTIGRAVITY_CLI_PROVIDER_KEY,
      modelKey,
      extensionId: ANTIGRAVITY_CLI_EXTENSION_ID,
      name: 'Gemini · Local Agent',
      state: 'UNAVAILABLE',
      availabilityReason: activated
        ? status?.state === 'ready'
          ? 'Antigravity CLI has no available Gemini model'
          : status?.message || 'Checking local Antigravity CLI'
        : 'Antigravity CLI is disabled or missing required permissions',
    },
  ];
}

export function listImageBreakdownRoutes(
  extensions: ExtensionRegistry,
  externalImageApis: ExternalImageApiConnections,
  deepSeekApi: DeepSeekApiConnection,
  antigravityStatus?: AntigravityCliStatusDto,
): ImageBreakdownRouteDto[] {
  const gemini = externalImageApis.status(GOOGLE_GEMINI_API_EXTENSION_ID);
  const deepSeek = deepSeekApi.status();
  const geminiPermission = externalImageApis.endpointPermission(GOOGLE_GEMINI_API_EXTENSION_ID);
  const geminiAuthorized =
    !geminiPermission || extensions.isPermissionGranted(GOOGLE_GEMINI_API_EXTENSION_ID, geminiPermission);
  const deepSeekPermission = deepSeekVisionEndpointPermission(deepSeek.visionEndpoint);
  const deepSeekAuthorized =
    !deepSeekPermission || extensions.isPermissionGranted(DEEPSEEK_API_EXTENSION_ID, deepSeekPermission);
  const deepSeekReferenceAuthorized = extensions.isPermissionGranted(
    DEEPSEEK_API_EXTENSION_ID,
    DEEPSEEK_VISION_REFERENCE_PERMISSION,
  );
  const deepSeekVisionConfigured = Boolean(deepSeek.visionEndpoint.trim() && deepSeek.visionModelId.trim());
  const deepSeekVisionReady =
    deepSeek.status === 'READY' && deepSeekVisionConfigured && deepSeekAuthorized && deepSeekReferenceAuthorized;

  return imageBreakdownRoutesSchema.parse([
    ...antigravityRoutes(extensions, antigravityStatus),
    {
      id: routeId('GOOGLE_GEMINI', GOOGLE_GEMINI_ASSISTANT_MODEL_KEY),
      key: 'GOOGLE_GEMINI',
      providerKey: 'google-gemini',
      modelKey: GOOGLE_GEMINI_ASSISTANT_MODEL_KEY,
      extensionId: GOOGLE_GEMINI_API_EXTENSION_ID,
      name: `Gemini · ${GOOGLE_GEMINI_ASSISTANT_MODEL_KEY}`,
      ...routeState(
        extensions.isActivated(GOOGLE_GEMINI_API_EXTENSION_ID),
        geminiAuthorized && (gemini.status === 'READY' || gemini.status === 'UNVERIFIED'),
        geminiAuthorized ? gemini.message : `Grant extension permission ${geminiPermission}`,
      ),
    },
    {
      id: routeId('DEEPSEEK_VL', deepSeek.visionModelId.trim() || 'deepseek-vl'),
      key: 'DEEPSEEK_VL',
      providerKey: 'deepseek',
      modelKey: deepSeek.visionModelId.trim() || 'deepseek-vl',
      extensionId: DEEPSEEK_API_EXTENSION_ID,
      name: `DeepSeek-VL · ${deepSeek.visionModelId.trim() || 'custom'}`,
      ...routeState(
        extensions.isActivated(DEEPSEEK_API_EXTENSION_ID),
        deepSeekVisionReady,
        deepSeekVisionReady
          ? deepSeek.message
          : deepSeek.status === 'READY' && !deepSeekVisionConfigured
            ? 'Configure a DeepSeek-VL endpoint and model ID'
            : !deepSeekReferenceAuthorized
              ? `Grant extension permission ${DEEPSEEK_VISION_REFERENCE_PERMISSION}`
              : !deepSeekAuthorized
                ? `Grant extension permission ${deepSeekPermission}`
                : deepSeek.message,
      ),
    },
  ]);
}
