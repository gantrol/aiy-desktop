import type { ImageGenerationRouteDto } from '@/shared/contracts';
import { CODEX_IMAGE_MODEL_ID, OPENAI_IMAGE_MODEL_KEY, OPENAI_IMAGE_PROVIDER_KEY } from '@/shared/extension-ids';
import type { LibraryDatabase } from '@/main/database';
import type { OpenAiImageApiRuntime } from '@/main/extensions/openai-image-api/runtime';
import { AdapterBackedGenerationModel } from '@/main/generation-models/adapters/adapter-backed-generation-model';
import type { NormalizedGenerationMedia } from '@/main/generation-models/adapters/contracts';
import type { GenerationProvider } from '@/main/generation-models/types';
import { OpenAiImageAdapter } from '@/main/generation-models/openai-image/openai-image-adapter';

function mimeTypeForPath(filePath: string) {
  const extension = filePath.toLowerCase();
  if (extension.endsWith('.jpg') || extension.endsWith('.jpeg')) return 'image/jpeg';
  if (extension.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function supportedGptImage2Size(width: number | null, height: number | null) {
  if (width === null || height === null) return true;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    longEdge <= 3_840 &&
    longEdge / shortEdge <= 3 &&
    pixels >= 655_360 &&
    pixels <= 8_294_400
  );
}

export class OpenAiImageProvider implements GenerationProvider {
  readonly key = OPENAI_IMAGE_PROVIDER_KEY;
  readonly name = 'OpenAI API';
  private readonly entries;

  constructor(
    database: LibraryDatabase,
    libraryRoot: string,
    runtime: OpenAiImageApiRuntime,
    isExtensionActivated: () => boolean,
  ) {
    const adapter = new OpenAiImageAdapter(runtime, libraryRoot);
    const descriptor = (): ImageGenerationRouteDto => {
      const active = isExtensionActivated();
      const status = runtime.status();
      return {
        key: OPENAI_IMAGE_MODEL_KEY,
        name: 'GPT Image 2 · API',
        provider: this.name,
        providerKey: this.key,
        modelId: CODEX_IMAGE_MODEL_ID,
        state: active && status.usable ? 'READY' : 'UNAVAILABLE',
        availabilityReason: active
          ? status.usable
            ? null
            : status.configured
              ? 'PROVIDER_CONNECTION_UNAVAILABLE'
              : 'PROVIDER_NOT_CONFIGURED'
          : 'EXTENSION_DISABLED',
        releaseStage: 'STABLE',
        internal: false,
        maxReferenceImages: adapter.maxReferenceImages,
        capabilities: [...adapter.capabilities],
        qualityMode: 'SELECTABLE',
        supportedQualities: ['low', 'medium', 'high'],
      };
    };
    this.entries = [
      new AdapterBackedGenerationModel({
        descriptor,
        adapter,
        createRequest: ({ runId, input, route }) => {
          const sourceAssetId = input.sourceAssetId?.trim() || null;
          const sourceFile = sourceAssetId ? database.resolveAssetFile(sourceAssetId) : null;
          if (sourceAssetId && !sourceFile) throw new Error('OpenAI image edit source is unavailable');
          const referenceAssetIds = input.referenceAssetIds.filter((assetId) => assetId !== sourceAssetId);
          const referencePaths = database.getReferencePaths(referenceAssetIds);
          if (referencePaths.length !== referenceAssetIds.length) {
            throw new Error('One or more OpenAI reference images are unavailable');
          }
          const media: NormalizedGenerationMedia[] = [];
          if (sourceAssetId && sourceFile)
            media.push({
              assetId: sourceAssetId,
              role: 'EDIT_SOURCE',
              localPath: sourceFile.absolutePath,
              mimeType: sourceFile.mimeType,
              ...(input.width !== null && input.height !== null
                ? {
                    width: input.width,
                    height: input.height,
                  }
                : {}),
            });
          media.push(
            ...referencePaths.map((localPath, index) => ({
              assetId: referenceAssetIds[index],
              role: 'REFERENCE' as const,
              localPath,
              mimeType: mimeTypeForPath(localPath),
            })),
          );
          const editSpec = sourceAssetId ? database.getGenerationEditSpec(runId) : null;
          if (editSpec && editSpec.sourceAssetId !== sourceAssetId) {
            throw new Error('OpenAI image edit spec does not match its source');
          }
          if (editSpec?.mode === 'MASK') {
            if (!editSpec.mask) throw new Error('OpenAI mask edit artifact is unavailable');
            media.push({
              assetId: editSpec.mask.id,
              role: 'MASK',
              localPath: editSpec.mask.localPath,
              mimeType: editSpec.mask.mimeType,
              width: editSpec.mask.width,
              height: editSpec.mask.height,
            });
          }
          // Imported edit sources may use arbitrary dimensions. Let GPT Image 2
          // choose an output size instead of misrepresenting an unsupported exact
          // size; the source and native mask still retain their original size.
          const useAutomaticEditSize = Boolean(sourceAssetId) && !supportedGptImage2Size(input.width, input.height);
          return {
            runId,
            modelKey: route.key,
            providerKey: route.providerKey,
            modelId: route.modelId,
            operation: sourceAssetId ? 'EDIT' : 'GENERATE',
            prompt: input.prompt,
            media,
            output: {
              width: useAutomaticEditSize ? null : input.width,
              height: useAutomaticEditSize ? null : input.height,
              quality: input.quality,
            },
            providerOptions: runtime.imageRequestOptions(),
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
}
