import type { ImageGenerationRouteCapability, ImageGenerationRouteDto } from '@/shared/contracts';
import type {
  GenerationAdapter,
  GenerationAdapterResult,
  GenerationMediaRole,
  NormalizedGenerationMedia,
  NormalizedGenerationRequest,
} from '@/main/generation-models/adapters/contracts';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';
import { resolveImageGenerationRouteExecutionIdentity } from '@/shared/image-generation-route-identity';

function invalidRequest(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new GenerationAdapterError({
    code: 'INVALID_REQUEST',
    message,
    details,
  });
}

function requireCapability(route: ImageGenerationRouteDto, capability: ImageGenerationRouteCapability, reason: string) {
  if (route.capabilities.includes(capability)) return;
  throw new GenerationAdapterError({
    code: 'UNSUPPORTED_CAPABILITY',
    message: `${route.name} does not support ${reason}`,
    details: { capability, routeKey: route.key },
  });
}

function assertNonEmpty(value: string, field: string) {
  if (!value.trim()) invalidRequest(`${field} must not be empty`, { field });
}

function assertOptionalDimension(value: number | undefined, field: string) {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    invalidRequest(`${field} must be a positive integer when provided`, { field, value });
  }
}

function validateMedia(media: NormalizedGenerationMedia, index: number) {
  assertNonEmpty(media.assetId, `media[${index}].assetId`);
  assertNonEmpty(media.localPath, `media[${index}].localPath`);
  assertNonEmpty(media.mimeType, `media[${index}].mimeType`);
  assertOptionalDimension(media.width, `media[${index}].width`);
  assertOptionalDimension(media.height, `media[${index}].height`);
  if ((media.width === undefined) !== (media.height === undefined)) {
    invalidRequest(`media[${index}] width and height must be provided together`, { index });
  }
}

function countRole(media: readonly NormalizedGenerationMedia[], role: GenerationMediaRole) {
  return media.filter((item) => item.role === role).length;
}

export function validateGenerationAdapterRequest(
  route: ImageGenerationRouteDto,
  adapter: Pick<GenerationAdapter, 'adapterId' | 'validateRequest'>,
  request: NormalizedGenerationRequest,
) {
  assertNonEmpty(request.runId, 'runId');
  assertNonEmpty(request.modelKey, 'modelKey');
  assertNonEmpty(request.providerKey, 'providerKey');
  assertNonEmpty(request.modelId, 'modelId');
  assertNonEmpty(request.prompt, 'prompt');

  if (request.modelKey !== route.key) {
    invalidRequest('Request modelKey does not match the selected image-generation route', {
      expected: route.key,
      actual: request.modelKey,
    });
  }
  if (request.providerKey !== route.providerKey || request.modelId !== route.modelId) {
    invalidRequest('Request provider identity does not match the selected image-generation route', {
      expectedProviderKey: route.providerKey,
      actualProviderKey: request.providerKey,
      expectedModelId: route.modelId,
      actualModelId: request.modelId,
    });
  }
  const routeIdentity = resolveImageGenerationRouteExecutionIdentity(route);
  if (adapter.adapterId && adapter.adapterId !== routeIdentity.adapterId) {
    invalidRequest('Adapter identity does not match the selected image-generation route', {
      expectedAdapterId: routeIdentity.adapterId,
      actualAdapterId: adapter.adapterId,
    });
  }
  if (request.executionIdentity) {
    const expected = JSON.stringify(routeIdentity);
    const actual = JSON.stringify(request.executionIdentity);
    if (actual !== expected) {
      invalidRequest('Request execution identity does not match the selected image-generation route', {
        expected: routeIdentity,
        actual: request.executionIdentity,
      });
    }
  }

  const { width, height } = request.output;
  if ((width === null) !== (height === null)) {
    invalidRequest('Output width and height must both be set or both be null');
  }
  if (width !== null && (!Number.isInteger(width) || width <= 0)) {
    invalidRequest('Output width must be a positive integer', { width });
  }
  if (height !== null && (!Number.isInteger(height) || height <= 0)) {
    invalidRequest('Output height must be a positive integer', { height });
  }

  request.media.forEach((media, index) => validateMedia(media, index));
  requireCapability(route, 'GENERATE', 'generation');

  const editSourceCount = countRole(request.media, 'EDIT_SOURCE');
  const referenceCount = countRole(request.media, 'REFERENCE');
  const guideCount = countRole(request.media, 'ANNOTATION_GUIDE');
  const maskCount = countRole(request.media, 'MASK');

  if (request.operation === 'GENERATE') {
    if (editSourceCount || guideCount || maskCount) {
      invalidRequest('GENERATE requests may only include REFERENCE media');
    }
  } else {
    if (editSourceCount !== 1) {
      invalidRequest('EDIT requests require exactly one EDIT_SOURCE', { editSourceCount });
    }
    requireCapability(route, 'IMAGE_EDIT', 'image editing');
  }

  if (guideCount > 1) {
    invalidRequest('At most one ANNOTATION_GUIDE is allowed', { guideCount });
  }
  if (maskCount > 1) invalidRequest('At most one MASK is allowed', { maskCount });
  if (maskCount) requireCapability(route, 'MASK_EDIT', 'mask editing');
  if (referenceCount || guideCount) {
    requireCapability(route, 'REFERENCE_IMAGE', 'reference images');
  }

  const inputImageCount = editSourceCount + referenceCount + guideCount;
  if (inputImageCount > 1) {
    requireCapability(route, 'MULTI_REFERENCE', 'multiple input images');
  }
  if (route.maxReferenceImages !== null && inputImageCount > route.maxReferenceImages) {
    throw new GenerationAdapterError({
      code: 'UNSUPPORTED_CAPABILITY',
      message: `${route.name} accepts at most ${route.maxReferenceImages} input images`,
      details: {
        capability: 'MULTI_REFERENCE',
        inputImageCount,
        maxReferenceImages: route.maxReferenceImages,
      },
    });
  }

  if (request.output.transparentBackground) {
    requireCapability(route, 'TRANSPARENT_BACKGROUND', 'transparent backgrounds');
  }

  if (request.continuation) {
    if (
      request.continuation.providerKey !== request.providerKey ||
      request.continuation.modelId !== request.modelId ||
      !Number.isInteger(request.continuation.schemaVersion) ||
      request.continuation.schemaVersion < 1
    ) {
      invalidRequest('Continuation state does not match the request provider and model');
    }
  }

  adapter.validateRequest?.(request);
}

export function validateGenerationAdapterResult(result: GenerationAdapterResult): GenerationAdapterResult {
  if (!result || typeof result !== 'object') {
    throw new GenerationAdapterError({
      code: 'NO_OUTPUT',
      message: 'Generation adapter returned no result',
    });
  }
  if (result.kind === 'FILE' && result.outputPath.trim()) return result;
  if (result.kind === 'LIBRARY_ASSET' && result.sourceAssetId.trim()) return result;
  throw new GenerationAdapterError({
    code: 'NO_OUTPUT',
    message: 'Generation adapter returned an empty output',
  });
}
