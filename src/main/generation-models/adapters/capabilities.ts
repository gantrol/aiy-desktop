import type { ImageGenerationRouteCapability, ImageGenerationRouteDto } from '@/shared/contracts';
import type { GenerationAdapter } from '@/main/generation-models/adapters/contracts';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';
import { resolveImageGenerationRouteExecutionIdentity } from '@/shared/image-generation-route-identity';

function assertReferenceLimit(name: string, value: number | null) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: `${name} must be a non-negative integer or null`,
      details: { name, value },
    });
  }
}

export function intersectGenerationCapabilities(
  routeCapabilities: readonly ImageGenerationRouteCapability[],
  adapterCapabilities: readonly ImageGenerationRouteCapability[],
): ImageGenerationRouteCapability[] {
  const implemented = new Set(adapterCapabilities);
  return [...new Set(routeCapabilities)].filter((capability) => implemented.has(capability));
}

export function intersectReferenceImageLimit(routeLimit: number | null, adapterLimit: number | null): number | null {
  assertReferenceLimit('route.maxReferenceImages', routeLimit);
  assertReferenceLimit('adapter.maxReferenceImages', adapterLimit);
  if (routeLimit === null) return adapterLimit;
  if (adapterLimit === null) return routeLimit;
  return Math.min(routeLimit, adapterLimit);
}

/** Returns only capabilities supported by both the catalog route and its adapter. */
export function effectiveImageGenerationRouteDescriptor(
  route: ImageGenerationRouteDto,
  adapter: Pick<GenerationAdapter, 'providerKey' | 'adapterId' | 'capabilities' | 'maxReferenceImages'>,
): ImageGenerationRouteDto {
  if (route.providerKey !== adapter.providerKey) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: `Adapter provider ${adapter.providerKey} cannot serve route provider ${route.providerKey}`,
      details: {
        adapterProviderKey: adapter.providerKey,
        routeProviderKey: route.providerKey,
      },
    });
  }
  const identity = resolveImageGenerationRouteExecutionIdentity(route);
  if (adapter.adapterId && identity.adapterId !== adapter.adapterId) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: `Adapter ${adapter.adapterId} cannot serve route adapter ${identity.adapterId}`,
      details: {
        adapterId: adapter.adapterId,
        routeAdapterId: identity.adapterId,
      },
    });
  }

  const capabilities = intersectGenerationCapabilities(route.capabilities, adapter.capabilities);
  const canGenerate = capabilities.includes('GENERATE');

  return {
    ...route,
    state: canGenerate ? route.state : 'UNAVAILABLE',
    availabilityReason: canGenerate ? route.availabilityReason : 'ADAPTER_CAPABILITY_MISMATCH',
    capabilities,
    maxReferenceImages: intersectReferenceImageLimit(route.maxReferenceImages, adapter.maxReferenceImages),
  };
}

/** @deprecated Use effectiveImageGenerationRouteDescriptor. */
export const effectiveGenerationModelDescriptor = effectiveImageGenerationRouteDescriptor;
