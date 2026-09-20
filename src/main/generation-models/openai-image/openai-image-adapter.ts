import { rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { OPENAI_IMAGE_MODELS, OPENAI_IMAGE_PROVIDER } from '@/main/extensions/openai-image-api/definition';
import type { OpenAiImageApiRuntime } from '@/main/extensions/openai-image-api/runtime';
import type {
  GenerationAdapter,
  GenerationAdapterExecutionContext,
  NormalizedGenerationOutput,
  NormalizedGenerationRequest,
} from '@/main/generation-models/adapters/contracts';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';
import { decodeGenerationProviderResponseJson } from '@/main/generation-models/adapters/generation-provider-response';
import {
  decodeProviderImageBase64,
  readValidatedReferenceImage,
  writeProviderImage,
} from '@/main/generation-models/adapters/provider-media';
import { tryDecodeProviderErrorJson } from '@/main/providers/provider-response';

export const OPENAI_IMAGE_API_BASE_URL = OPENAI_IMAGE_PROVIDER.baseUrl;
const MAX_OPENAI_REFERENCE_BYTES = 25 * 1024 * 1024;

const openAiImageSuccessSchema = z
  .object({
    data: z.array(
      z
        .object({
          b64_json: z.string().min(1).optional(),
          revised_prompt: z.string().optional(),
          url: z.string().url().optional(),
        })
        .passthrough(),
    ),
    quality: z.string().optional(),
    size: z.string().optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const openAiImageErrorSchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        code: z.string().nullable().optional(),
        type: z.string().optional(),
        param: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
        moderation_details: z
          .object({
            moderation_stage: z.enum(['input', 'output', 'unknown']).optional(),
            categories: z.array(z.string()).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

type OpenAiImageErrorResponse = z.infer<typeof openAiImageErrorSchema>;

interface ParsedOpenAiImageError {
  message?: string;
  providerCode?: string;
  providerType?: string;
  providerParam?: string | number | boolean | null;
  moderationStage?: 'input' | 'output' | 'unknown';
  moderationCategories: string[];
}

function moderationStage(value: unknown): ParsedOpenAiImageError['moderationStage'] {
  return value === 'input' || value === 'output' || value === 'unknown' ? value : undefined;
}

function moderationCategories(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((category): category is string => typeof category === 'string' && Boolean(category.trim()))
        .map((category) => category.trim().slice(0, 100)),
    ),
  ].slice(0, 20);
}

function providerParam(value: unknown): ParsedOpenAiImageError['providerParam'] {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

function parseOpenAiImageError(body: OpenAiImageErrorResponse): ParsedOpenAiImageError {
  const error = body.error;
  const message =
    typeof error?.message === 'string' && error.message.trim() ? error.message.trim().slice(0, 1_000) : undefined;
  return {
    ...(message ? { message } : {}),
    ...(typeof error?.code === 'string' ? { providerCode: error.code } : {}),
    ...(typeof error?.type === 'string' ? { providerType: error.type } : {}),
    ...(providerParam(error?.param) !== undefined ? { providerParam: providerParam(error?.param) } : {}),
    ...(moderationStage(error?.moderation_details?.moderation_stage)
      ? { moderationStage: moderationStage(error?.moderation_details?.moderation_stage) }
      : {}),
    moderationCategories: moderationCategories(error?.moderation_details?.categories),
  };
}

function openAiErrorMetadata(status: number, requestId: string | undefined, error: ParsedOpenAiImageError) {
  return {
    httpStatus: status,
    ...(requestId ? { requestId } : {}),
    ...(error.providerType ? { providerType: error.providerType } : {}),
    ...(error.providerParam !== undefined ? { providerParam: error.providerParam } : {}),
    ...(error.moderationStage ? { moderationStage: error.moderationStage } : {}),
    ...(error.moderationCategories.length ? { moderationCategories: error.moderationCategories } : {}),
  };
}

function outputSize(request: NormalizedGenerationRequest) {
  return request.output.width !== null && request.output.height !== null
    ? `${request.output.width}x${request.output.height}`
    : 'auto';
}

function validateGptImageSize(output: NormalizedGenerationOutput) {
  const { width, height } = output;
  if (width === null || height === null) return;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  if (
    width % 16 !== 0 ||
    height % 16 !== 0 ||
    longEdge > 3_840 ||
    longEdge / shortEdge > 3 ||
    pixels < 655_360 ||
    pixels > 8_294_400
  ) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: 'GPT Image output dimensions are outside the supported size constraints',
      details: { width, height },
    });
  }
}

function apiHeaders(credentials: ReturnType<OpenAiImageApiRuntime['credentials']>) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${credentials.apiKey}`,
  };
  if (credentials.organizationId) headers['OpenAI-Organization'] = credentials.organizationId;
  if (credentials.projectId) headers['OpenAI-Project'] = credentials.projectId;
  return headers;
}

function providerErrorCode(status: number) {
  if (status === 401 || status === 403) return 'AUTH' as const;
  if (status === 429) return 'RATE_LIMITED' as const;
  if (status >= 500) return 'PROVIDER_UNAVAILABLE' as const;
  return 'INVALID_REQUEST' as const;
}

function moderationForRequest(request: NormalizedGenerationRequest) {
  const moderation = request.providerOptions?.moderation;
  if (moderation === undefined) return undefined;
  if (moderation === 'auto' || moderation === 'low') return moderation;
  throw new GenerationAdapterError({
    code: 'INVALID_REQUEST',
    message: 'OpenAI moderation must be auto or low',
    details: { moderation },
  });
}

export class OpenAiImageAdapter implements GenerationAdapter {
  readonly providerKey = 'openai';
  readonly adapterId = 'openai-images-v1';
  readonly capabilities = ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT', 'MASK_EDIT'] as const;
  readonly maxReferenceImages = 8;

  constructor(
    private readonly runtime: OpenAiImageApiRuntime,
    private readonly libraryRoot: string,
    private readonly fetchImpl: typeof fetch = fetch,
    /**
     * Main-process injection point only. Never routed through IPC or renderer
     * settings: a configurable endpoint would let untrusted state redirect
     * credentialed requests. Tests point this at the loopback protocol stub.
     */
    private readonly baseUrl: string = OPENAI_IMAGE_API_BASE_URL,
  ) {}

  validateOutput(output: NormalizedGenerationOutput) {
    validateGptImageSize(output);
  }

  validateRequest(request: NormalizedGenerationRequest) {
    const model = OPENAI_IMAGE_MODELS.find((candidate) => candidate.modelId === request.modelId);
    if (!model) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: `Unsupported OpenAI image model: ${request.modelId}`,
      });
    }
    const supportedQualities: readonly string[] = model.supportedQualities;
    if (!supportedQualities.includes(request.output.quality)) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: `${request.modelId} does not support ${request.output.quality} quality`,
      });
    }
    if (request.prompt.length > 32_000) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: 'GPT Image prompts must not exceed 32,000 characters',
      });
    }
    moderationForRequest(request);
    this.validateOutput(request.output);
    const source = request.media.find((item) => item.role === 'EDIT_SOURCE');
    const mask = request.media.find((item) => item.role === 'MASK');
    if (mask) {
      if (mask.mimeType !== 'image/png') {
        throw new GenerationAdapterError({ code: 'INVALID_REQUEST', message: 'OpenAI image edit masks must be PNG' });
      }
      if (!source || source.width === undefined || source.height === undefined) {
        throw new GenerationAdapterError({
          code: 'INVALID_REQUEST',
          message: 'OpenAI mask edits require known source dimensions',
        });
      }
      if (mask.width !== source.width || mask.height !== source.height) {
        throw new GenerationAdapterError({
          code: 'INVALID_REQUEST',
          message: 'OpenAI mask dimensions must match the edit source',
        });
      }
      if (source.mimeType !== mask.mimeType) {
        throw new GenerationAdapterError({
          code: 'INVALID_REQUEST',
          message: 'OpenAI mask format must match the edit source',
        });
      }
    }
  }

  bindRequest(request: NormalizedGenerationRequest) {
    const credentials = this.credentialsForRequest();
    return (context: GenerationAdapterExecutionContext) => this.executeWithCredentials(request, context, credentials);
  }

  execute(request: NormalizedGenerationRequest, context: GenerationAdapterExecutionContext) {
    return this.bindRequest(request)(context);
  }

  private credentialsForRequest() {
    let credentials: ReturnType<OpenAiImageApiRuntime['credentials']>;
    try {
      credentials = this.runtime.credentials();
    } catch (error) {
      throw new GenerationAdapterError({
        code: 'AUTH',
        message: error instanceof Error ? error.message : 'OpenAI API connection is not ready',
        cause: error,
      });
    }
    return credentials;
  }

  private async executeWithCredentials(
    request: NormalizedGenerationRequest,
    context: GenerationAdapterExecutionContext,
    credentials: ReturnType<OpenAiImageApiRuntime['credentials']>,
  ) {
    const source = request.media.find((item) => item.role === 'EDIT_SOURCE');
    const references = request.media.filter((item) => item.role === 'REFERENCE' || item.role === 'ANNOTATION_GUIDE');
    const mask = request.media.find((item) => item.role === 'MASK');
    const imageInputs = [...(source ? [source] : []), ...references];
    context.emit({ type: 'PROGRESS', stage: 'PREPARING', message: 'Preparing OpenAI image request' });
    const response =
      request.operation === 'EDIT' || imageInputs.length > 0
        ? await this.createEdit(request, imageInputs, mask, credentials, context)
        : await this.createGeneration(request, credentials, context);
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (requestId) context.emit({ type: 'REQUEST_ACCEPTED', providerRequestId: requestId });
    if (!response.ok) throw await this.responseError(response, requestId);
    context.emit({ type: 'PROGRESS', stage: 'DOWNLOADING', message: 'Receiving generated image' });
    const body = await decodeGenerationProviderResponseJson(response, openAiImageSuccessSchema, 'OpenAI Image');
    const image = body.data[0];
    if (!image?.b64_json) {
      throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'OpenAI returned no image data' });
    }
    const outputPath = this.outputPath(request.runId);
    writeProviderImage(outputPath, decodeProviderImageBase64(image.b64_json, ['image/png']), ['image/png']);
    context.emit({ type: 'PROGRESS', stage: 'FINALIZING', message: 'Saving generated image' });
    return {
      kind: 'FILE' as const,
      outputPath,
      mimeType: 'image/png',
      ...(requestId ? { providerRequestId: requestId } : {}),
      responseMetadata: {
        quality: body.quality ?? request.output.quality,
        size: body.size ?? outputSize(request),
        ...(body.usage ? { usage: body.usage } : {}),
      },
      ...(image.revised_prompt
        ? { providerReturnedDescriptions: [{ fieldName: 'revised_prompt', rawValue: image.revised_prompt }] }
        : {}),
    };
  }

  cleanup(runId: string) {
    const directory = path.dirname(this.outputPath(runId));
    rmSync(directory, { recursive: true, force: true });
  }

  private createGeneration(
    request: NormalizedGenerationRequest,
    credentials: ReturnType<OpenAiImageApiRuntime['credentials']>,
    context: GenerationAdapterExecutionContext,
  ) {
    context.emit({ type: 'PROGRESS', stage: 'UPLOADING', message: 'Submitting OpenAI image request' });
    const moderation = moderationForRequest(request);
    const response = this.fetchRequest(
      `${this.baseUrl}/images/generations`,
      {
        method: 'POST',
        headers: { ...apiHeaders(credentials), 'Content-Type': 'application/json' },
        signal: context.signal,
        body: JSON.stringify({
          model: request.modelId,
          prompt: request.prompt,
          n: 1,
          quality: request.output.quality,
          size: outputSize(request),
          output_format: 'png',
          ...(moderation ? { moderation } : {}),
        }),
      },
      context.signal,
    );
    context.emit({ type: 'PROGRESS', stage: 'GENERATING', message: 'OpenAI is generating the image' });
    return response;
  }

  private createEdit(
    request: NormalizedGenerationRequest,
    imageInputs: NormalizedGenerationRequest['media'],
    mask: NormalizedGenerationRequest['media'][number] | undefined,
    credentials: ReturnType<OpenAiImageApiRuntime['credentials']>,
    context: GenerationAdapterExecutionContext,
  ) {
    context.emit({
      type: 'PROGRESS',
      stage: 'UPLOADING',
      message: `Uploading ${imageInputs.length} image input${imageInputs.length === 1 ? '' : 's'}`,
    });
    const form = new FormData();
    form.set('model', request.modelId);
    form.set('prompt', request.prompt);
    form.set('n', '1');
    form.set('quality', request.output.quality);
    form.set('size', outputSize(request));
    form.set('output_format', 'png');
    const moderation = moderationForRequest(request);
    if (moderation) form.set('moderation', moderation);
    for (const image of imageInputs) {
      const { bytes, mimeType } = readValidatedReferenceImage(
        image.localPath,
        image.mimeType,
        MAX_OPENAI_REFERENCE_BYTES,
      );
      form.append('image[]', new Blob([new Uint8Array(bytes)], { type: mimeType }), path.basename(image.localPath));
    }
    if (mask) {
      const { bytes } = readValidatedReferenceImage(mask.localPath, mask.mimeType, MAX_OPENAI_REFERENCE_BYTES);
      form.set('mask', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), path.basename(mask.localPath));
    }
    const response = this.fetchRequest(
      `${this.baseUrl}/images/edits`,
      {
        method: 'POST',
        headers: apiHeaders(credentials),
        signal: context.signal,
        body: form,
      },
      context.signal,
    );
    context.emit({ type: 'PROGRESS', stage: 'GENERATING', message: 'OpenAI is generating from the references' });
    return response;
  }

  private async fetchRequest(url: string, init: RequestInit, signal: AbortSignal) {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      throw new GenerationAdapterError({
        code: 'NETWORK',
        message: 'OpenAI image request could not reach the API',
        cause: error,
      });
    }
  }

  private async responseError(response: Response, requestId?: string) {
    let message = `OpenAI image request failed with HTTP ${response.status}`;
    let parsed: ParsedOpenAiImageError = { moderationCategories: [] };
    try {
      const body = await tryDecodeProviderErrorJson(response, openAiImageErrorSchema, 'OpenAI Image');
      if (body) {
        parsed = parseOpenAiImageError(body);
        if (parsed.message) message = parsed.message;
      }
    } catch {
      // Preserve the stable HTTP fallback.
    }
    return new GenerationAdapterError({
      code: providerErrorCode(response.status),
      message,
      ...(parsed.providerCode ? { providerCode: parsed.providerCode } : {}),
      details: openAiErrorMetadata(response.status, requestId, parsed),
    });
  }

  private outputPath(runId: string) {
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(runId)) {
      throw new GenerationAdapterError({ code: 'LOCAL_STATE', message: 'Unsafe OpenAI generation run id' });
    }
    const root = path.resolve(this.libraryRoot);
    const output = path.resolve(root, 'temp', 'openai-image-api', runId, 'result.png');
    if (!output.startsWith(`${root}${path.sep}`)) {
      throw new GenerationAdapterError({ code: 'LOCAL_STATE', message: 'Unsafe OpenAI generation output path' });
    }
    return output;
  }
}
