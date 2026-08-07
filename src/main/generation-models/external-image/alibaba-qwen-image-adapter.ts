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
import { tryDecodeProviderErrorJson } from '@/main/provider-response';
import {
  cleanupOutput,
  downloadHttpsImage,
  fetchProvider,
  mediaDataUrl,
  outputPath,
  providerError,
  writeOutput,
} from '@/main/generation-models/external-image/adapter-utils';
import { ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID } from '@/shared/extension-ids';

const alibabaSuccessSchema = z
  .object({
    output: z.object({
      choices: z
        .array(
          z.object({
            message: z.object({
              content: z.array(z.object({ image: z.string().url().optional() }).passthrough()),
            }),
          }),
        )
        .min(1),
    }),
    usage: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string().optional(),
  })
  .passthrough();

const alibabaErrorSchema = z
  .object({
    request_id: z.string().optional(),
    code: z.string().min(1),
    message: z.string().optional(),
  })
  .passthrough();

const alibabaResponseSchema = z.union([
  alibabaErrorSchema.transform((data) => ({ kind: 'error' as const, data })),
  alibabaSuccessSchema.transform((data) => ({ kind: 'success' as const, data })),
]);

const MAX_QWEN_REFERENCE_BYTES = 10 * 1024 * 1024;

export class AlibabaQwenImageAdapter implements GenerationAdapter {
  readonly providerKey = 'alibaba-cloud';
  readonly capabilities = ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT'] as const;
  readonly maxReferenceImages = 3;
  private readonly namespace = 'alibaba-model-studio-image-api';

  constructor(
    private readonly runtime: ExternalImageApiRuntime,
    private readonly libraryRoot: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  validateRequest(request: NormalizedGenerationRequest) {
    const credentials = this.runtime.credentials(ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID);
    const expectedModelId = resolveExternalImageApiEndpoint(
      ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
      credentials.settings,
    ).modelId;
    if (request.modelId !== expectedModelId) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: 'Alibaba image configuration changed before the request started',
      });
    }
    if (request.output.width && request.output.height) {
      const pixels = request.output.width * request.output.height;
      if (pixels < 512 * 512 || pixels > 2048 * 2048) {
        throw new GenerationAdapterError({
          code: 'INVALID_REQUEST',
          message: 'Qwen Image output must contain between 512×512 and 2048×2048 pixels',
        });
      }
    }
  }

  async execute(request: NormalizedGenerationRequest, context: GenerationAdapterExecutionContext) {
    const credentials = this.runtime.credentials(ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID);
    const provider = resolveExternalImageApiEndpoint(ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID, credentials.settings);
    const references = request.media.filter((item) => item.role === 'EDIT_SOURCE' || item.role === 'REFERENCE');
    context.emit({ type: 'PROGRESS', stage: 'PREPARING', message: 'Preparing Qwen Image request' });
    if (references.length) {
      context.emit({
        type: 'PROGRESS',
        stage: 'UPLOADING',
        message: `Uploading ${references.length} reference image${references.length === 1 ? '' : 's'}`,
      });
    } else {
      context.emit({ type: 'PROGRESS', stage: 'UPLOADING', message: 'Submitting Qwen Image request' });
    }
    const parameters: Record<string, unknown> = {
      prompt_extend: true,
      n: 1,
      watermark: false,
    };
    if (request.output.width && request.output.height) {
      parameters.size = `${request.output.width}*${request.output.height}`;
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
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  ...references.map((reference) => ({
                    image: mediaDataUrl(reference, MAX_QWEN_REFERENCE_BYTES),
                  })),
                  { text: request.prompt },
                ],
              },
            ],
          },
          parameters,
        }),
      },
      context.signal,
    );
    context.emit({ type: 'PROGRESS', stage: 'GENERATING', message: 'Qwen Image is generating the image' });
    const response = await responsePromise;
    if (!response.ok) {
      const body = await tryDecodeProviderErrorJson(response, alibabaErrorSchema, 'Alibaba Model Studio');
      const requestId = response.headers.get('x-request-id') ?? body?.request_id ?? undefined;
      context.emit({ type: 'REQUEST_ACCEPTED', ...(requestId ? { providerRequestId: requestId } : {}) });
      throw providerError({
        provider: 'Alibaba Model Studio',
        status: response.status,
        requestId,
        message: body?.message,
        code: body?.code,
      });
    }
    const decoded = await decodeGenerationProviderResponseJson(response, alibabaResponseSchema, 'Alibaba Model Studio');
    const requestId = response.headers.get('x-request-id') ?? decoded.data.request_id ?? undefined;
    context.emit({ type: 'REQUEST_ACCEPTED', ...(requestId ? { providerRequestId: requestId } : {}) });
    if (decoded.kind === 'error') {
      const status = /(?:api.?key|unauthori[sz]ed|permission|access.?denied)/i.test(decoded.data.code) ? 401 : 400;
      throw providerError({
        provider: 'Alibaba Model Studio',
        status,
        requestId,
        message: decoded.data.message,
        code: decoded.data.code,
      });
    }
    const body = decoded.data;
    const imageUrl = body.output?.choices?.[0]?.message?.content?.find((item) => typeof item.image === 'string')?.image;
    if (typeof imageUrl !== 'string' || !imageUrl) {
      throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Qwen Image returned no image URL' });
    }
    context.emit({ type: 'PROGRESS', stage: 'DOWNLOADING', message: 'Downloading Qwen Image result' });
    const outputHosts = provider.custom ? ['aliyuncs.com', new URL(provider.endpoint).hostname] : ['aliyuncs.com'];
    const bytes = await downloadHttpsImage(this.fetchImpl, imageUrl, context.signal, outputHosts);
    const target = outputPath(this.libraryRoot, this.namespace, request.runId);
    writeOutput(target, bytes);
    context.emit({ type: 'PROGRESS', stage: 'FINALIZING', message: 'Saving generated image' });
    return {
      kind: 'FILE' as const,
      outputPath: target,
      mimeType: 'image/png',
      ...(requestId ? { providerRequestId: requestId } : {}),
      responseMetadata: {
        ...(body.usage ? { usage: body.usage } : {}),
        promptExtended: true,
        modelId: provider.modelId,
        endpointPresetId: provider.endpointPresetId,
      },
    };
  }

  cleanup(runId: string) {
    cleanupOutput(this.libraryRoot, this.namespace, runId);
  }
}
