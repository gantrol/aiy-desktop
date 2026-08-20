import type {
  ImageGenerationRouteDto,
  ImageGenerationRouteQualityMode,
  ImageGenerationRouteReleaseStage,
  GenerationQuality,
} from '@/shared/contracts';
import type { ExternalImageApiExtensionId } from '@/shared/extension-ids';
import { DEFAULT_IMAGE_PROMPT_PROFILE_ID } from '@/shared/image-generation-prompt-profile';
import {
  ALIBABA_IMAGE_PROVIDER_ID,
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  externalImageConnectionId,
  GOOGLE_IMAGE_PROVIDER_ID,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  VOLCENGINE_IMAGE_PROVIDER_ID,
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
  providerId: string;
  providerName: string;
  adapterId: string;
  /** Route-neutral product label. Connection/plugin copy belongs to the extension manifest. */
  modelName: string;
  defaultModelId: string;
  canonicalModelFamilyId: string;
  releaseStage: ImageGenerationRouteReleaseStage;
  qualityMode: ImageGenerationRouteQualityMode;
  supportedQualities: GenerationQuality[];
  adapter: GenerationAdapter & { cleanup(runId: string): void };
}

class ExternalImageGenerationProvider implements GenerationProvider {
  readonly definition;
  private readonly entries: ImageGenerationRoute[];

  constructor(
    database: LibraryDatabase,
    runtime: ExternalImageApiRuntime,
    isActivated: (extensionId: ExternalImageApiExtensionId) => boolean,
    spec: ProviderSpec,
  ) {
    this.definition = { id: spec.providerId, name: spec.providerName, extensionId: spec.extensionId };
    const descriptor = (): ImageGenerationRouteDto => {
      const active = isActivated(spec.extensionId);
      const status = runtime.status(spec.extensionId);
      let modelId = spec.defaultModelId;
      if (status.usable) {
        const credentials = runtime.credentials(spec.extensionId);
        modelId = resolveExternalImageApiEndpoint(spec.extensionId, credentials.settings).modelId;
      }
      const routeId = `${spec.providerId}/${modelId}`;
      const connectionId = externalImageConnectionId(spec.extensionId);
      return {
        key: routeId,
        name: modelId === spec.defaultModelId ? spec.modelName : modelId,
        provider: spec.providerName,
        providerKey: spec.providerId,
        modelId,
        executionIdentity: {
          routeId,
          providerId: spec.providerId,
          connectionId,
          adapterId: spec.adapterId,
          modelId,
          canonicalModelFamilyId: modelId === spec.defaultModelId ? spec.canonicalModelFamilyId : null,
          promptProfileId: DEFAULT_IMAGE_PROMPT_PROFILE_ID,
          resourcePoolKey: connectionId,
        },
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
          const sourcePath = sourceAssetId ? database.getGenerationAssetPath(sourceAssetId) : null;
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
          const editSpec = sourceAssetId ? database.getGenerationEditSpec(runId) : null;
          if (editSpec && editSpec.sourceAssetId !== sourceAssetId) {
            throw new Error('Provider image edit spec does not match its source');
          }
          const usesNativeMask = editSpec?.mode === 'MASK' && route.capabilities.includes('MASK_EDIT');
          if (usesNativeMask) {
            if (!editSpec.mask) throw new Error('Provider image edit mask is unavailable');
            media.push({
              assetId: editSpec.mask.id,
              role: 'MASK',
              localPath: editSpec.mask.localPath,
              mimeType: editSpec.mask.mimeType,
              width: editSpec.mask.width,
              height: editSpec.mask.height,
            });
          } else if (editSpec) {
            const guide = database.getGenerationEditGuide(runId);
            if (!guide) throw new Error('Provider image edit range guide is unavailable');
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
            executionIdentity: route.executionIdentity,
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

  get key() {
    return this.definition.id;
  }

  get name() {
    return this.definition.name;
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
      providerId: GOOGLE_IMAGE_PROVIDER_ID,
      providerName: 'Google Gemini API',
      adapterId: 'google-gemini-interactions-image',
      modelName: 'Nano Banana 2',
      defaultModelId: GOOGLE_GEMINI_DEFAULT_MODEL_ID,
      canonicalModelFamilyId: `google/${GOOGLE_GEMINI_DEFAULT_MODEL_ID}`,
      releaseStage: 'STABLE',
      qualityMode: 'SELECTABLE',
      supportedQualities: ['low', 'medium', 'high'],
      adapter: new GoogleGeminiImageAdapter(runtime, libraryRoot),
    }),
    new ExternalImageGenerationProvider(database, runtime, isActivated, {
      extensionId: ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
      providerId: ALIBABA_IMAGE_PROVIDER_ID,
      providerName: 'Alibaba Model Studio',
      adapterId: 'alibaba-model-studio-image',
      modelName: 'Qwen Image 3.0 Pro',
      defaultModelId: ALIBABA_QWEN_DEFAULT_MODEL_ID,
      canonicalModelFamilyId: `alibaba/${ALIBABA_QWEN_DEFAULT_MODEL_ID}`,
      releaseStage: 'PREVIEW',
      qualityMode: 'PROVIDER_MANAGED',
      supportedQualities: [],
      adapter: new AlibabaQwenImageAdapter(runtime, libraryRoot),
    }),
    new ExternalImageGenerationProvider(database, runtime, isActivated, {
      extensionId: VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
      providerId: VOLCENGINE_IMAGE_PROVIDER_ID,
      providerName: 'Volcengine Ark',
      adapterId: 'volcengine-ark-image',
      modelName: 'Seedream 5.0',
      defaultModelId: VOLCENGINE_SEEDREAM_DEFAULT_MODEL_ID,
      canonicalModelFamilyId: `bytedance/${VOLCENGINE_SEEDREAM_DEFAULT_MODEL_ID}`,
      releaseStage: 'STABLE',
      qualityMode: 'PROVIDER_MANAGED',
      supportedQualities: [],
      adapter: new VolcengineSeedreamImageAdapter(runtime, libraryRoot),
    }),
  ];
}
