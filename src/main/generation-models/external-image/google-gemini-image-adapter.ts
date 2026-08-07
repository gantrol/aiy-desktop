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
  outputPath,
  providerError,
  referenceBase64,
  writeOutput,
} from '@/main/generation-models/external-image/adapter-utils';
import { GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID } from '@/shared/extension-ids';

const googleImageBlockSchema = z
  .object({
    type: z.literal('image').optional(),
    data: z.string().min(1),
    mime_type: z.literal('image/png').optional(),
  })
  .passthrough();

const googleSuccessSchema = z
  .object({
    id: z.string().optional(),
    output_image: googleImageBlockSchema.optional(),
    steps: z
      .array(
        z
          .object({
            type: z.string(),
            content: z.array(googleImageBlockSchema).optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => value.output_image !== undefined || value.steps !== undefined, {
    message: 'Expected output_image or steps',
  });

const googleErrorSchema = z
  .object({
    id: z.string().optional(),
    error: z
      .object({
        message: z.string().optional(),
        code: z.union([z.string(), z.number()]).optional(),
        status: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

type GoogleInteractionResponse = z.infer<typeof googleSuccessSchema>;

const ratios = [
  '1:8',
  '1:4',
  '9:16',
  '2:3',
  '3:4',
  '4:5',
  '1:1',
  '5:4',
  '4:3',
  '3:2',
  '16:9',
  '21:9',
  '4:1',
  '8:1',
] as const;

function closestAspectRatio(width: number | null, height: number | null) {
  if (!width || !height) return '1:1';
  const actual = width / height;
  return ratios.reduce((best, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(':').map(Number);
    const [bestWidth, bestHeight] = best.split(':').map(Number);
    const candidateDistance = Math.abs(Math.log(actual / (candidateWidth / candidateHeight)));
    const bestDistance = Math.abs(Math.log(actual / (bestWidth / bestHeight)));
    return candidateDistance < bestDistance ? candidate : best;
  });
}

function imageSize(quality: NormalizedGenerationRequest['output']['quality']) {
  if (quality === 'high') return '4K';
  if (quality === 'medium') return '2K';
  return '1K';
}

function outputImage(body: GoogleInteractionResponse) {
  if (
    typeof body.output_image?.data === 'string' &&
    (body.output_image.type === undefined || body.output_image.type === 'image')
  )
    return body.output_image;
  for (const step of body.steps ?? []) {
    if (step.type !== 'model_output') continue;
    const image = step.content?.find((item) => item.type === 'image' && typeof item.data === 'string');
    if (image) return image;
  }
  return null;
}

export class GoogleGeminiImageAdapter implements GenerationAdapter {
  readonly providerKey = 'google';
  readonly capabilities = ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT'] as const;
  readonly maxReferenceImages = 14;
  private readonly namespace = 'google-gemini-image-api';

  constructor(
    private readonly runtime: ExternalImageApiRuntime,
    private readonly libraryRoot: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  validateRequest(request: NormalizedGenerationRequest) {
    const credentials = this.runtime.credentials(GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID);
    const expectedModelId = resolveExternalImageApiEndpoint(
      GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
      credentials.settings,
    ).modelId;
    if (request.modelId !== expectedModelId) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: 'Google image configuration changed before the request started',
      });
    }
  }

  async execute(request: NormalizedGenerationRequest, context: GenerationAdapterExecutionContext) {
    const credentials = this.runtime.credentials(GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID);
    const provider = resolveExternalImageApiEndpoint(GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID, credentials.settings);
    context.emit({ type: 'PROGRESS', stage: 'PREPARING', message: 'Preparing Gemini image request' });
    const references = request.media.filter((item) => item.role === 'EDIT_SOURCE' || item.role === 'REFERENCE');
    const input: Array<Record<string, string>> = [
      { type: 'text', text: request.prompt },
      ...references.map((reference) => ({
        type: 'image',
        mime_type: reference.mimeType,
        data: referenceBase64(reference),
      })),
    ];
    if (references.length) {
      context.emit({
        type: 'PROGRESS',
        stage: 'UPLOADING',
        message: `Uploading ${references.length} reference image${references.length === 1 ? '' : 's'}`,
      });
    } else {
      context.emit({ type: 'PROGRESS', stage: 'UPLOADING', message: 'Submitting Gemini image request' });
    }
    const responsePromise = fetchProvider(
      this.fetchImpl,
      provider.endpoint,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-goog-api-key': credentials.apiKey,
        },
        signal: context.signal,
        body: JSON.stringify({
          model: provider.modelId,
          input,
          store: false,
          response_format: {
            type: 'image',
            mime_type: 'image/png',
            delivery: 'inline',
            aspect_ratio: closestAspectRatio(request.output.width, request.output.height),
            image_size: imageSize(request.output.quality),
          },
        }),
      },
      context.signal,
    );
    context.emit({ type: 'PROGRESS', stage: 'GENERATING', message: 'Gemini is generating the image' });
    const response = await responsePromise;
    if (!response.ok) {
      const body = await tryDecodeProviderErrorJson(response, googleErrorSchema, 'Google Gemini');
      const requestId = response.headers.get('x-request-id') ?? body?.id ?? undefined;
      context.emit({ type: 'REQUEST_ACCEPTED', ...(requestId ? { providerRequestId: requestId } : {}) });
      throw providerError({
        provider: 'Google Gemini',
        status: response.status,
        requestId,
        message: body?.error.message,
        code: body?.error.status ?? body?.error.code,
      });
    }
    const body = await decodeGenerationProviderResponseJson(response, googleSuccessSchema, 'Google Gemini');
    const requestId = response.headers.get('x-request-id') ?? body.id ?? undefined;
    context.emit({ type: 'REQUEST_ACCEPTED', ...(requestId ? { providerRequestId: requestId } : {}) });
    const image = outputImage(body);
    if (!image || typeof image.data !== 'string' || !image.data) {
      throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Gemini returned no image data' });
    }
    context.emit({ type: 'PROGRESS', stage: 'DOWNLOADING', message: 'Receiving Gemini image' });
    const target = outputPath(this.libraryRoot, this.namespace, request.runId);
    writeOutput(target, decodeProviderImageBase64(image.data, ['image/png']));
    context.emit({ type: 'PROGRESS', stage: 'FINALIZING', message: 'Saving generated image' });
    return {
      kind: 'FILE' as const,
      outputPath: target,
      mimeType: image.mime_type ?? 'image/png',
      ...(requestId ? { providerRequestId: requestId } : {}),
      responseMetadata: {
        aspectRatio: closestAspectRatio(request.output.width, request.output.height),
        imageSize: imageSize(request.output.quality),
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
