import { z } from 'zod';
import { resolveExternalImageApiEndpoint } from '@/main/extensions/external-image-api/endpoints';
import type { ExternalImageApiRuntime } from '@/main/extensions/external-image-api/runtime';
import type {
  GenerationAdapter,
  GenerationAdapterExecutionContext,
  NormalizedGenerationRequest,
} from '@/main/generation-models/adapters/contracts';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';
import { decodeGenerationProviderResponseJson } from '@/main/generation-models/adapters/generation-provider-response';
import { decodeProviderImageBase64 } from '@/main/generation-models/adapters/provider-media';
import { tryDecodeProviderErrorJson } from '@/main/provider-response';
import {
  cleanupOutput,
  fetchProvider,
  mediaDataUrl,
  outputPath,
  providerError,
  writeOutput,
} from '@/main/generation-models/external-image/adapter-utils';
import { VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID } from '@/shared/extension-ids';

const volcengineSuccessSchema = z
  .object({
    id: z.string().optional(),
    request_id: z.string().optional(),
    model: z.string().optional(),
    data: z.array(
      z
        .object({
          b64_json: z.string().min(1).optional(),
          size: z.string().optional(),
        })
        .passthrough(),
    ),
    usage: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const volcengineErrorSchema = z
  .object({
    id: z.string().optional(),
    request_id: z.string().optional(),
    error: z
      .object({
        message: z.string().optional(),
        code: z.string().optional(),
      })
      .passthrough()
      .optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

function requestedSize(request: NormalizedGenerationRequest) {
  return request.output.width && request.output.height ? `${request.output.width}x${request.output.height}` : '2K';
}

export class VolcengineSeedreamImageAdapter implements GenerationAdapter {
  readonly providerKey = 'volcengine';
  readonly capabilities = ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT'] as const;
  readonly maxReferenceImages = 8;
  private readonly namespace = 'volcengine-ark-image-api';

  constructor(
    private readonly runtime: ExternalImageApiRuntime,
    private readonly libraryRoot: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  validateRequest(request: NormalizedGenerationRequest) {
    const credentials = this.runtime.credentials(VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID);
    const expectedModelId = resolveExternalImageApiEndpoint(
      VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
      credentials.settings,
    ).modelId;
    if (request.modelId !== expectedModelId) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: 'Volcengine image configuration changed before the request started',
      });
    }
  }

  async execute(request: NormalizedGenerationRequest, context: GenerationAdapterExecutionContext) {
    const credentials = this.runtime.credentials(VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID);
    const provider = resolveExternalImageApiEndpoint(VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID, credentials.settings);
    const references = request.media.filter((item) => item.role === 'EDIT_SOURCE' || item.role === 'REFERENCE');
    context.emit({ type: 'PROGRESS', stage: 'PREPARING', message: 'Preparing Seedream image request' });
    if (references.length) {
      context.emit({
        type: 'PROGRESS',
        stage: 'UPLOADING',
        message: `Uploading ${references.length} reference image${references.length === 1 ? '' : 's'}`,
      });
    } else {
      context.emit({ type: 'PROGRESS', stage: 'UPLOADING', message: 'Submitting Seedream image request' });
    }
    const responsePromise = fetchProvider(
      this.fetchImpl,
      provider.endpoint,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: context.signal,
        body: JSON.stringify({
          model: provider.modelId,
          prompt: request.prompt,
          ...(references.length
            ? {
                image:
                  references.length === 1
                    ? mediaDataUrl(references[0])
                    : references.map((reference) => mediaDataUrl(reference)),
              }
            : {}),
          size: requestedSize(request),
          response_format: 'b64_json',
          output_format: 'png',
          watermark: false,
        }),
      },
      context.signal,
    );
    context.emit({ type: 'PROGRESS', stage: 'GENERATING', message: 'Seedream is generating the image' });
    const response = await responsePromise;
    if (!response.ok) {
      const body = await tryDecodeProviderErrorJson(response, volcengineErrorSchema, 'Volcengine Ark');
      const requestId = response.headers.get('x-request-id') ?? body?.request_id ?? body?.id ?? undefined;
      context.emit({ type: 'REQUEST_ACCEPTED', ...(requestId ? { providerRequestId: requestId } : {}) });
      throw providerError({
        provider: 'Volcengine Ark',
        status: response.status,
        requestId,
        message: body?.error?.message ?? body?.message,
        code: body?.error?.code ?? body?.code,
      });
    }
    const body = await decodeGenerationProviderResponseJson(response, volcengineSuccessSchema, 'Volcengine Ark');
    const requestId = response.headers.get('x-request-id') ?? body.request_id ?? body.id ?? undefined;
    context.emit({ type: 'REQUEST_ACCEPTED', ...(requestId ? { providerRequestId: requestId } : {}) });
    const image = body.data[0];
    if (!image?.b64_json) {
      throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Seedream returned no image data' });
    }
    context.emit({ type: 'PROGRESS', stage: 'DOWNLOADING', message: 'Receiving Seedream image' });
    const target = outputPath(this.libraryRoot, this.namespace, request.runId);
    writeOutput(target, decodeProviderImageBase64(image.b64_json, ['image/png']));
    context.emit({ type: 'PROGRESS', stage: 'FINALIZING', message: 'Saving generated image' });
    return {
      kind: 'FILE' as const,
      outputPath: target,
      mimeType: 'image/png',
      ...(requestId ? { providerRequestId: requestId } : {}),
      responseMetadata: {
        size: image.size ?? requestedSize(request),
        modelId: provider.modelId,
        endpointPresetId: provider.endpointPresetId,
        ...(body.usage ? { usage: body.usage } : {}),
      },
    };
  }

  cleanup(runId: string) {
    cleanupOutput(this.libraryRoot, this.namespace, runId);
  }
}
