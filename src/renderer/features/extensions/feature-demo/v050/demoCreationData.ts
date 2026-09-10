import type { AssetDto, ImageGenerationRouteDto } from '@/shared/contracts';
import { demoMedia } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';

export const demoNoop = () => {};
export const demoAsyncNoop = async () => {};
export const demoGenerationTargets = [{ modelKey: 'demo-prepared', count: 1, quality: 'low' as const }];
export const demoRoseAsset: AssetDto = {
  id: 'demo-roses',
  kind: 'REFERENCE',
  width: 1024,
  height: 1536,
  mimeType: 'image/webp',
  byteSize: 2043574,
  mediaUrl: demoMedia.roses,
  createdAt: '2026-09-10T00:00:00.000Z',
};

/** Presentation data, never registered with a provider or generation executor. */
export function demoPreparedRoute(name: string): ImageGenerationRouteDto {
  return {
    key: 'demo-prepared',
    name,
    provider: 'AIY',
    providerKey: 'demo',
    modelId: 'demo-prepared',
    state: 'READY',
    availabilityReason: null,
    releaseStage: 'INTERNAL',
    internal: true,
    maxReferenceImages: 1,
    capabilities: ['GENERATE', 'REFERENCE_IMAGE'],
    qualityMode: 'PROVIDER_MANAGED',
    supportedQualities: [],
  };
}
