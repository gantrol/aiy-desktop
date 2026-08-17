import type { GenerationInput, ImageGenerationRouteDto } from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import type { GenerationStarted, ImageGenerationRoute } from '@/main/generation-models/types';
import { DEFAULT_IMAGE_PROMPT_PROFILE_ID } from '@/shared/image-generation-prompt-profile';

export const internalLibraryRandomModelKey = 'internal-library-random';

export class InternalLibraryRandomModel implements ImageGenerationRoute {
  constructor(
    private readonly database: Pick<LibraryDatabase, 'hasGenerationReplaySources' | 'listGenerationReplaySources'>,
    private readonly random: () => number = Math.random,
  ) {}

  get descriptor(): ImageGenerationRouteDto {
    const available = this.database.hasGenerationReplaySources();
    return {
      key: internalLibraryRandomModelKey,
      name: '素材随机挡板',
      provider: 'Internal',
      providerKey: 'internal',
      modelId: internalLibraryRandomModelKey,
      executionIdentity: {
        routeId: internalLibraryRandomModelKey,
        providerId: 'internal',
        connectionId: 'internal:library',
        adapterId: 'internal:library-replay',
        modelId: internalLibraryRandomModelKey,
        canonicalModelFamilyId: null,
        promptProfileId: DEFAULT_IMAGE_PROMPT_PROFILE_ID,
        resourcePoolKey: 'internal:library',
      },
      state: available ? 'READY' : 'UNAVAILABLE',
      availabilityReason: available ? null : 'NO_LIBRARY_IMAGES',
      releaseStage: 'INTERNAL',
      internal: true,
      maxReferenceImages: 8,
      capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE'],
      qualityMode: 'PROVIDER_MANAGED',
      supportedQualities: [],
    };
  }

  prepareExecution(_runId: string, _input: GenerationInput) {
    const candidates = this.database.listGenerationReplaySources();
    if (!candidates.length) throw new Error('当前资料库没有可供挡板模型返回的图片素材');
    const random = Math.max(0, Math.min(0.9999999999999999, this.random()));
    const sourceAssetId = candidates[Math.floor(random * candidates.length)];
    return {
      requestSnapshot: {
        route: 'INTERNAL_REPLAY' as const,
        requestSchema: 'internal-library-replay.v1',
        actualRequest: { operation: 'REPLAY_LIBRARY_ASSET', sourceAssetId },
        clientRequestText: null,
      },
      execute: async (onStarted: GenerationStarted) => {
        onStarted();
        return { kind: 'LIBRARY_ASSET' as const, sourceAssetId };
      },
    };
  }
}
