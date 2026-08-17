import type { ImageGenerationRouteDto, ImageGenerationRouteExecutionIdentityDto } from '@/shared/contracts';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';

function requiredIdentityPart(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Image-generation route ${field} must not be empty`);
  return normalized;
}

/**
 * Reads the canonical execution identity while keeping old snapshots and
 * lightweight test routes usable. New live routes must carry an explicit
 * executionIdentity and are checked by the route registry.
 */
export function resolveImageGenerationRouteExecutionIdentity(
  route: Pick<ImageGenerationRouteDto, 'key' | 'providerKey' | 'modelId' | 'executionIdentity'>,
): ImageGenerationRouteExecutionIdentityDto {
  if (!route.executionIdentity) {
    return {
      routeId: route.key,
      providerId: route.providerKey,
      connectionId: `legacy:${route.providerKey}`,
      adapterId: `legacy:${route.providerKey}`,
      modelId: route.modelId,
      canonicalModelFamilyId: null,
      promptProfileId: imageGenerationPromptProfileId(route),
      resourcePoolKey: `legacy:${route.providerKey}`,
    };
  }
  return route.executionIdentity;
}

export function assertImageGenerationRouteExecutionIdentity(route: ImageGenerationRouteDto) {
  const identity = resolveImageGenerationRouteExecutionIdentity(route);
  requiredIdentityPart(identity.routeId, 'routeId');
  requiredIdentityPart(identity.providerId, 'providerId');
  requiredIdentityPart(identity.connectionId, 'connectionId');
  requiredIdentityPart(identity.adapterId, 'adapterId');
  requiredIdentityPart(identity.modelId, 'modelId');
  requiredIdentityPart(identity.promptProfileId, 'promptProfileId');
  requiredIdentityPart(identity.resourcePoolKey, 'resourcePoolKey');
  if (identity.routeId !== route.key) {
    throw new Error(`Image-generation route identity mismatch: ${route.key}`);
  }
  if (identity.modelId !== route.modelId) {
    throw new Error(`Image-generation route model identity mismatch: ${route.key}`);
  }
  return identity;
}

export function snapshotImageGenerationRoute(route: ImageGenerationRouteDto): ImageGenerationRouteDto {
  return {
    ...route,
    capabilities: [...route.capabilities],
    supportedQualities: [...route.supportedQualities],
    ...(route.executionIdentity ? { executionIdentity: { ...route.executionIdentity } } : {}),
  };
}
