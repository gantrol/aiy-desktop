import type { LibraryDatabase } from '@/main/database';
import type { ExternalImageApiRuntime } from '@/main/extensions/external-image-api/runtime';
import { AdapterBackedGenerationModel } from '@/main/generation-models/adapters/adapter-backed-generation-model';
import type { NormalizedGenerationMedia } from '@/main/generation-models/adapters/contracts';
import { CpaImageAdapter } from '@/main/generation-models/cpa-image/cpa-image-adapter';
import type { GenerationProvider } from '@/main/generation-models/types';
import type { ImageGenerationRouteDto } from '@/shared/contracts';
import {
  CPA_IMAGE_API_EXTENSION_ID,
  CPA_IMAGE_CONNECTION_ID,
  CPA_IMAGE_FLARE_MODEL_KEY,
  CPA_IMAGE_PROVIDER_KEY,
  CPA_IMAGE_SUNBURST_MODEL_KEY,
} from '@/shared/extension-ids';
import { DEFAULT_IMAGE_PROMPT_PROFILE_ID } from '@/shared/image-generation-prompt-profile';

const MODELS = [
  { key: CPA_IMAGE_FLARE_MODEL_KEY, modelId: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare' },
  { key: CPA_IMAGE_SUNBURST_MODEL_KEY, modelId: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst' },
] as const;

function mimeTypeForPath(localPath: string) {
  if (/\.jpe?g$/i.test(localPath)) return 'image/jpeg';
  if (/\.webp$/i.test(localPath)) return 'image/webp';
  return 'image/png';
}

function supportedSize(width: number | null, height: number | null) {
  if (width === null || height === null) return true;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    longEdge <= 3840 &&
    longEdge / shortEdge <= 3 &&
    pixels >= 655_360 &&
    pixels <= 8_294_400
  );
}

export class CpaImageProvider implements GenerationProvider {
  readonly definition = {
    id: CPA_IMAGE_PROVIDER_KEY,
    name: 'Codex backend · CPA',
    extensionId: CPA_IMAGE_API_EXTENSION_ID,
  };
  readonly key = CPA_IMAGE_PROVIDER_KEY;
  readonly name = this.definition.name;
  private readonly entries;

  constructor(
    database: LibraryDatabase,
    libraryRoot: string,
    runtime: ExternalImageApiRuntime,
    isActivated: () => boolean,
  ) {
    const adapter = new CpaImageAdapter(runtime, libraryRoot);
    const descriptor = (model: (typeof MODELS)[number]): ImageGenerationRouteDto => {
      const active = isActivated();
      const status = runtime.status(CPA_IMAGE_API_EXTENSION_ID);
      return {
        key: model.key,
        name: `${model.name} · CPA`,
        provider: this.name,
        providerKey: this.key,
        modelId: model.modelId,
        executionIdentity: {
          routeId: model.key,
          providerId: this.key,
          connectionId: CPA_IMAGE_CONNECTION_ID,
          adapterId: adapter.adapterId,
          modelId: model.modelId,
          canonicalModelFamilyId: `openai/${model.modelId}`,
          promptProfileId: DEFAULT_IMAGE_PROMPT_PROFILE_ID,
          resourcePoolKey: CPA_IMAGE_CONNECTION_ID,
        },
        state: active && status.usable ? 'READY' : 'UNAVAILABLE',
        availabilityReason: active
          ? status.usable
            ? null
            : status.configured
              ? 'PROVIDER_CONNECTION_UNAVAILABLE'
              : 'PROVIDER_NOT_CONFIGURED'
          : 'EXTENSION_DISABLED',
        releaseStage: 'PREVIEW',
        internal: false,
        maxReferenceImages: adapter.maxReferenceImages,
        capabilities: [...adapter.capabilities],
        qualityMode: 'SELECTABLE',
        supportedQualities: ['low', 'medium', 'high', 'xhigh', 'max'],
      };
    };
    this.entries = MODELS.map(
      (model) =>
        new AdapterBackedGenerationModel({
          descriptor: () => descriptor(model),
          adapter,
          createRequest: ({ runId, input, route }) => {
            const sourceAssetId = input.sourceAssetId?.trim() || null;
            const sourceFile = sourceAssetId ? database.resolveAssetFile(sourceAssetId) : null;
            const sourcePath = sourceAssetId ? database.getGenerationAssetPath(sourceAssetId) : null;
            if (sourceAssetId && (!sourceFile || !sourcePath)) throw new Error('CPA image edit source is unavailable');
            const referenceAssetIds = input.referenceAssetIds.filter((id) => id !== sourceAssetId);
            const referencePaths = database.getReferencePaths(referenceAssetIds);
            if (referencePaths.length !== referenceAssetIds.length)
              throw new Error('CPA image reference is unavailable');
            const media: NormalizedGenerationMedia[] = [];
            if (sourceAssetId && sourceFile && sourcePath) {
              media.push({
                assetId: sourceAssetId,
                role: 'EDIT_SOURCE',
                localPath: sourcePath,
                mimeType: sourceFile.mimeType === 'image/svg+xml' ? 'image/png' : sourceFile.mimeType,
                ...(input.width !== null && input.height !== null ? { width: input.width, height: input.height } : {}),
              });
            }
            const editSpec = sourceAssetId ? database.getGenerationEditSpec(runId) : null;
            if (editSpec && editSpec.sourceAssetId !== sourceAssetId) throw new Error('CPA image edit source mismatch');
            if (editSpec?.mode === 'MASK') {
              if (!editSpec.mask) throw new Error('CPA image edit mask is unavailable');
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
              if (!guide) throw new Error('CPA image edit guide is unavailable');
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
            const automaticEditSize = Boolean(sourceAssetId) && !supportedSize(input.width, input.height);
            return {
              runId,
              modelKey: route.key,
              providerKey: route.providerKey,
              modelId: route.modelId,
              executionIdentity: route.executionIdentity,
              operation: sourceAssetId ? ('EDIT' as const) : ('GENERATE' as const),
              prompt: input.prompt,
              media,
              output: {
                width: automaticEditSize ? null : input.width,
                height: automaticEditSize ? null : input.height,
                quality: input.quality,
              },
              providerOptions: {
                requestedSurface: 'IMAGE_API',
                requestedApiPath:
                  sourceAssetId || media.some((item) => item.role === 'REFERENCE' || item.role === 'ANNOTATION_GUIDE')
                    ? '/images/edits'
                    : '/images/generations',
                connector: 'CPA',
              },
              continuation: null,
            };
          },
          cleanup: (request) => adapter.cleanup(request.runId),
        }),
    );
  }

  routes() {
    return this.entries;
  }
}
