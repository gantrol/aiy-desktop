import type {
  ImageGenerationRouteDto,
  ImageGenerationRouteQualityMode,
  ImageGenerationRouteReleaseStage,
  GenerationQuality,
} from '@/shared/contracts';
import type { ExternalImageApiExtensionId } from '@/shared/extension-ids';
import {
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';
import type { LibraryDatabase } from '@/main/database';
import {
  ALIBABA_QWEN_DEFAULT_MODEL_ID,
  GOOGLE_GEMINI_DEFAULT_MODEL_ID,
  VOLCENGINE_SEEDREAM_DEFAULT_MODEL_ID,
  resolveExternalImageApiEndpoint,
} from '@/main/extensions/external-image-api/endpoints';
import type { ExternalImageApiRuntime } from '@/main/extensions/external-image-api/runtime';
import { AdapterBackedGenerationModel } from '@/main/generation-models/adapters/adapter-backed-generation-model';
import type { GenerationAdapter, NormalizedGenerationMedia } from '@/main/generation-models/adapters/contracts';
import { AlibabaQwenImageAdapter } from '@/main/generation-models/external-image/alibaba-qwen-image-adapter';
import { mimeTypeForPath } from '@/main/generation-models/external-image/adapter-utils';
import { GoogleGeminiImageAdapter } from '@/main/generation-models/external-image/google-gemini-image-adapter';
import { VolcengineSeedreamImageAdapter } from '@/main/generation-models/external-image/volcengine-seedream-image-adapter';
import type { GenerationProvider, ImageGenerationRoute } from '@/main/generation-models/types';

interface ProviderSpec {
  extensionId: ExternalImageApiExtensionId;
  providerKey: string;
  providerName: string;
  modelKey: string;
  /** Route-neutral product label. Connection/plugin copy belongs to the extension manifest. */
  modelName: string;
  modelId: string;
  releaseStage: ImageGenerationRouteReleaseStage;
  qualityMode: ImageGenerationRouteQualityMode;
  supportedQualities: GenerationQuality[];
  adapter: GenerationAdapter & { cleanup(runId: string): void };
}

class ExternalImageGenerationProvider implements GenerationProvider {
  readonly key: string;
  readonly name: string;
  private readonly entries: ImageGenerationRoute[];

  constructor(
    database: LibraryDatabase,
    runtime: ExternalImageApiRuntime,
    isActivated: (extensionId: ExternalImageApiExtensionId) => boolean,
    spec: ProviderSpec,
  ) {
    this.key = spec.providerKey;
    this.name = spec.providerName;
    const descriptor = (): ImageGenerationRouteDto => {
      const active = isActivated(spec.extensionId);
      const status = runtime.status(spec.extensionId);
      let modelId = spec.modelId;
      if (status.usable) {
        const credentials = runtime.credentials(spec.extensionId);
        modelId = resolveExternalImageApiEndpoint(spec.extensionId, credentials.settings).modelId;
      }
      return {
        key: spec.modelKey,
        name: spec.modelName,
        provider: spec.providerName,
        providerKey: spec.providerKey,
        modelId,
        state: active && status.usable ? 'READY' : 'UNAVAILABLE',
        availabilityReason: active
          ? status.usable
            ? null
            : status.configured
              ? 'PROVIDER_CONNECTION_UNAVAILABLE'
              : 'PROVIDER_NOT_CONFIGURED'
          : 'EXTENSION_DISABLED',
        releaseStage: spec.releaseStage,
        internal: false,
        maxReferenceImages: spec.adapter.maxReferenceImages,
        capabilities: [...spec.adapter.capabilities],
        qualityMode: spec.qualityMode,
        supportedQualities: spec.supportedQualities,
      };
    };
    this.entries = [
      new AdapterBackedGenerationModel({
        descriptor,
        adapter: spec.adapter,
        createRequest: ({ runId, input, route }) => {
          const sourceAssetId = input.sourceAssetId?.trim() || null;
          const sourcePath = sourceAssetId ? database.getAssetPath(sourceAssetId) : null;
          if (sourceAssetId && !sourcePath) throw new Error('Provider image edit source is unavailable');
          const referenceAssetIds = input.referenceAssetIds.filter((assetId) => assetId !== sourceAssetId);
          const paths = database.getReferencePaths(referenceAssetIds);
          if (paths.length !== referenceAssetIds.length) {
            throw new Error('One or more provider reference images are unavailable');
          }
          const media: NormalizedGenerationMedia[] = [];
          if (sourceAssetId && sourcePath)
            media.push({
              assetId: sourceAssetId,
              role: 'EDIT_SOURCE',
              localPath: sourcePath,
              mimeType: mimeTypeForPath(sourcePath),
              ...(input.width !== null && input.height !== null ? { width: input.width, height: input.height } : {}),
            });
          media.push(
            ...paths.map((localPath, index) => ({
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
            operation: sourceAssetId ? 'EDIT' : 'GENERATE',
            prompt: input.prompt,
            media,
            output: {
              width: input.width,
              height: input.height,
              quality: input.quality,
            },
            continuation: null,
          };
        },
        cleanup: (request) => spec.adapter.cleanup(request.runId),
      }),
    ];
  }

  routes() {
    return this.entries;
  }
}

export function createExternalImageProviders(
  database: LibraryDatabase,
  libraryRoot: string,
  runtime: ExternalImageApiRuntime,
  isActivated: (extensionId: ExternalImageApiExtensionId) => boolean,
): GenerationProvider[] {
  return [
    new ExternalImageGenerationProvider(database, runtime, isActivated, {
      extensionId: GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
      providerKey: 'google',
      providerName: 'Google Gemini API',
      modelKey: `google/${GOOGLE_GEMINI_DEFAULT_MODEL_ID}`,
      modelName: 'Nano Banana 2',
      modelId: GOOGLE_GEMINI_DEFAULT_MODEL_ID,
      releaseStage: 'STABLE',
      qualityMode: 'SELECTABLE',
      supportedQualities: ['low', 'medium', 'high'],
      adapter: new GoogleGeminiImageAdapter(runtime, libraryRoot),
    }),
    new ExternalImageGenerationProvider(database, runtime, isActivated, {
      extensionId: ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
      providerKey: 'alibaba-cloud',
      providerName: 'Alibaba Model Studio',
      modelKey: `alibaba-cloud/${ALIBABA_QWEN_DEFAULT_MODEL_ID}`,
      modelName: 'Qwen Image 3.0 Pro',
      modelId: ALIBABA_QWEN_DEFAULT_MODEL_ID,
      releaseStage: 'PREVIEW',
      qualityMode: 'PROVIDER_MANAGED',
      supportedQualities: [],
      adapter: new AlibabaQwenImageAdapter(runtime, libraryRoot),
    }),
    new ExternalImageGenerationProvider(database, runtime, isActivated, {
      extensionId: VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
      providerKey: 'volcengine',
      providerName: 'Volcengine Ark',
      modelKey: `volcengine/${VOLCENGINE_SEEDREAM_DEFAULT_MODEL_ID}`,
      modelName: 'Seedream 5.0',
      modelId: VOLCENGINE_SEEDREAM_DEFAULT_MODEL_ID,
      releaseStage: 'STABLE',
      qualityMode: 'PROVIDER_MANAGED',
      supportedQualities: [],
      adapter: new VolcengineSeedreamImageAdapter(runtime, libraryRoot),
    }),
  ];
}
