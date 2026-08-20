import type { ImageGenerationRouteDto } from '@/shared/contracts';
import {
  ANTIGRAVITY_CLI_CONNECTION_ID,
  ANTIGRAVITY_CLI_EXTENSION_ID,
  ANTIGRAVITY_CLI_IMAGE_MODEL_ID,
  ANTIGRAVITY_CLI_IMAGE_MODEL_KEY,
  ANTIGRAVITY_CLI_PROVIDER_KEY,
} from '@/shared/extension-ids';
import { DEFAULT_IMAGE_PROMPT_PROFILE_ID } from '@/shared/image-generation-prompt-profile';
import type { LibraryDatabase } from '@/main/database';
import type { AntigravityCliRuntime } from '@/main/extensions/antigravity-cli/runtime';
import { AdapterBackedGenerationModel } from '@/main/generation-models/adapters/adapter-backed-generation-model';
import type { NormalizedGenerationMedia } from '@/main/generation-models/adapters/contracts';
import { mimeTypeForPath } from '@/main/generation-models/external-image/adapter-utils';
import { AntigravityImageAdapter } from '@/main/generation-models/antigravity-cli/antigravity-image-adapter';
import type { GenerationProvider, ImageGenerationRoute } from '@/main/generation-models/types';

export class AntigravityImageProvider implements GenerationProvider {
  readonly definition = {
    id: ANTIGRAVITY_CLI_PROVIDER_KEY,
    name: 'Google Antigravity CLI',
    extensionId: ANTIGRAVITY_CLI_EXTENSION_ID,
  };
  private readonly entries: ImageGenerationRoute[];

  constructor(
    database: LibraryDatabase,
    runtime: AntigravityCliRuntime,
    libraryRoot: string,
    isActivated: () => boolean,
  ) {
    const adapter = new AntigravityImageAdapter(runtime, libraryRoot);
    const descriptor = (): ImageGenerationRouteDto => {
      const active = isActivated();
      const status = runtime.status;
      const ready = active && status.state === 'ready';
      return {
        key: ANTIGRAVITY_CLI_IMAGE_MODEL_KEY,
        name: 'Antigravity Image Agent',
        provider: 'Google Antigravity CLI',
        providerKey: ANTIGRAVITY_CLI_PROVIDER_KEY,
        modelId: ANTIGRAVITY_CLI_IMAGE_MODEL_ID,
        executionIdentity: {
          routeId: ANTIGRAVITY_CLI_IMAGE_MODEL_KEY,
          providerId: ANTIGRAVITY_CLI_PROVIDER_KEY,
          connectionId: ANTIGRAVITY_CLI_CONNECTION_ID,
          adapterId: adapter.adapterId,
          modelId: ANTIGRAVITY_CLI_IMAGE_MODEL_ID,
          canonicalModelFamilyId: null,
          promptProfileId: DEFAULT_IMAGE_PROMPT_PROFILE_ID,
          resourcePoolKey: ANTIGRAVITY_CLI_CONNECTION_ID,
        },
        state: ready ? 'READY' : 'UNAVAILABLE',
        availabilityReason: active ? (ready ? null : 'ANTIGRAVITY_CLI_UNAVAILABLE') : 'EXTENSION_DISABLED',
        releaseStage: 'PREVIEW',
        internal: false,
        maxReferenceImages: adapter.maxReferenceImages,
        capabilities: [...adapter.capabilities],
        qualityMode: 'PROVIDER_MANAGED',
        supportedQualities: [],
      };
    };
    this.entries = [
      new AdapterBackedGenerationModel({
        descriptor,
        adapter,
        createRequest: ({ runId, input, route }) => {
          const sourceAssetId = input.sourceAssetId?.trim() || null;
          const sourcePath = sourceAssetId ? database.getGenerationAssetPath(sourceAssetId) : null;
          if (sourceAssetId && !sourcePath) throw new Error('Antigravity image edit source is unavailable');
          const referenceAssetIds = input.referenceAssetIds.filter((assetId) => assetId !== sourceAssetId);
          const referencePaths = database.getReferencePaths(referenceAssetIds);
          if (referencePaths.length !== referenceAssetIds.length) {
            throw new Error('One or more Antigravity reference images are unavailable');
          }
          const media: NormalizedGenerationMedia[] = [];
          if (sourceAssetId && sourcePath) {
            media.push({
              assetId: sourceAssetId,
              role: 'EDIT_SOURCE',
              localPath: sourcePath,
              mimeType: mimeTypeForPath(sourcePath),
              ...(input.width !== null && input.height !== null ? { width: input.width, height: input.height } : {}),
            });
          }
          const editSpec = sourceAssetId ? database.getGenerationEditSpec(runId) : null;
          if (editSpec && editSpec.sourceAssetId !== sourceAssetId) {
            throw new Error('Antigravity image edit range does not match its source');
          }
          if (editSpec) {
            const guide = database.getGenerationEditGuide(runId);
            if (!guide) throw new Error('Antigravity image edit range guide is unavailable');
            media.push({
              assetId: guide.id,
              role: 'ANNOTATION_GUIDE',
              localPath: guide.localPath,
              mimeType: guide.mimeType,
              width: guide.width,
              height: guide.height,
            });
          }
          media.push(
            ...referencePaths.map((localPath, index) => ({
              assetId: referenceAssetIds[index],
              role: 'REFERENCE' as const,
              localPath,
              mimeType: mimeTypeForPath(localPath),
            })),
          );
          return {
            runId,
            modelKey: route.key,
            providerKey: route.providerKey,
            modelId: route.modelId,
            executionIdentity: route.executionIdentity,
            operation: sourceAssetId ? ('EDIT' as const) : ('GENERATE' as const),
            prompt: input.prompt,
            media,
            output: { width: input.width, height: input.height, quality: input.quality },
            continuation: null,
          };
        },
        cleanup: (request) => adapter.cleanup(request.runId),
      }),
    ];
  }

  routes() {
    return this.entries;
  }

  get key() {
    return this.definition.id;
  }

  get name() {
    return this.definition.name;
  }
}
