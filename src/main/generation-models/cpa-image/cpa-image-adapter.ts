import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { validatedCpaImageBaseUrl } from '@/main/extensions/cpa-image/endpoint';
import type { ExternalImageApiRuntime } from '@/main/extensions/external-image-api/runtime';
import type {
  GenerationAdapter,
  GenerationAdapterExecutionContext,
  NormalizedGenerationOutput,
  NormalizedGenerationRequest,
} from '@/main/generation-models/adapters/contracts';
import { GenerationAdapterError } from '@/main/generation-models/adapters/errors';
import { decodeGenerationProviderResponseJson } from '@/main/generation-models/adapters/generation-provider-response';
import { decodeProviderImageBase64, validateProviderImage } from '@/main/generation-models/adapters/provider-media';
import { tryDecodeProviderErrorJson } from '@/main/providers/provider-response';
import { CPA_IMAGE_API_EXTENSION_ID, CPA_IMAGE_PROVIDER_KEY } from '@/shared/extension-ids';

const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
const responseSchema = z
  .object({
    data: z.array(z.object({ b64_json: z.string().optional(), revised_prompt: z.string().optional() }).passthrough()),
    usage: z.record(z.string(), z.unknown()).optional(),
    quality: z.string().optional(),
    size: z.string().optional(),
  })
  .passthrough();
const errorSchema = z
  .object({ error: z.object({ message: z.string().optional(), code: z.string().optional() }).passthrough() })
  .passthrough();

function outputSize(request: NormalizedGenerationRequest) {
  return request.output.width !== null && request.output.height !== null
    ? `${request.output.width}x${request.output.height}`
    : 'auto';
}

function validateSize(output: NormalizedGenerationOutput) {
  const { width, height } = output;
  if (width === null || height === null) return;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  if (
    width % 16 ||
    height % 16 ||
    longEdge > 3840 ||
    longEdge / shortEdge > 3 ||
    pixels < 655_360 ||
    pixels > 8_294_400
  ) {
    throw new GenerationAdapterError({
      code: 'INVALID_REQUEST',
      message: 'GPT Image output dimensions are unsupported',
    });
  }
}

function outputPath(libraryRoot: string, runId: string) {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(runId)) {
    throw new GenerationAdapterError({ code: 'LOCAL_STATE', message: 'Unsafe generation run id' });
  }
  const root = path.resolve(libraryRoot);
  const target = path.resolve(root, 'temp', 'cpa-image-api', runId, 'result.png');
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new GenerationAdapterError({ code: 'LOCAL_STATE', message: 'Unsafe generation output path' });
  }
  return target;
}

async function readImage(image: NormalizedGenerationRequest['media'][number]) {
  const bytes = await readFile(image.localPath);
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) {
    throw new GenerationAdapterError({ code: 'INVALID_REQUEST', message: 'Reference image size is unsupported' });
  }
  let mimeType: string;
  try {
    mimeType = validateProviderImage(bytes);
  } catch (error) {
    throw new GenerationAdapterError({ code: 'INVALID_REQUEST', message: 'Reference image is invalid', cause: error });
  }
  if (mimeType !== image.mimeType) {
    throw new GenerationAdapterError({ code: 'INVALID_REQUEST', message: 'Reference image format changed' });
  }
  return { bytes, mimeType };
}

async function saveImage(target: string, bytes: Buffer) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class CpaImageAdapter implements GenerationAdapter {
  readonly providerKey = CPA_IMAGE_PROVIDER_KEY;
  readonly adapterId = 'cpa-openai-images-v1';
  readonly capabilities = ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT', 'MASK_EDIT'] as const;
  readonly maxReferenceImages = 8;

  constructor(
    private readonly runtime: ExternalImageApiRuntime,
    private readonly libraryRoot: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  validateOutput(output: NormalizedGenerationOutput) {
    validateSize(output);
  }

  validateRequest(request: NormalizedGenerationRequest) {
    if (!['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(request.modelId)) {
      throw new GenerationAdapterError({ code: 'INVALID_REQUEST', message: 'Unsupported CPA image model' });
    }
    if (request.prompt.length > 32_000 || !request.prompt.trim()) {
      throw new GenerationAdapterError({ code: 'INVALID_REQUEST', message: 'GPT Image prompt is invalid' });
    }
    this.validateOutput(request.output);
    const source = request.media.find((item) => item.role === 'EDIT_SOURCE');
    const mask = request.media.find((item) => item.role === 'MASK');
    if (
      mask &&
      (!source ||
        mask.mimeType !== 'image/png' ||
        source.mimeType !== 'image/png' ||
        mask.width !== source.width ||
        mask.height !== source.height)
    ) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: 'CPA image mask must match a PNG edit source',
      });
    }
  }

  bindRequest(request: NormalizedGenerationRequest) {
    const credentials = this.runtime.credentials(CPA_IMAGE_API_EXTENSION_ID);
    const baseUrl = validatedCpaImageBaseUrl(credentials.settings.baseUrl);
    return (context: GenerationAdapterExecutionContext) =>
      this.executeBound(request, context, credentials.apiKey, baseUrl);
  }

  execute(request: NormalizedGenerationRequest, context: GenerationAdapterExecutionContext) {
    return this.bindRequest(request)(context);
  }

  private async executeBound(
    request: NormalizedGenerationRequest,
    context: GenerationAdapterExecutionContext,
    apiKey: string,
    baseUrl: string,
  ) {
    const images = request.media.filter(
      (item) => item.role === 'EDIT_SOURCE' || item.role === 'REFERENCE' || item.role === 'ANNOTATION_GUIDE',
    );
    const mask = request.media.find((item) => item.role === 'MASK');
    const editing = request.operation === 'EDIT' || images.length > 0;
    const apiPath = editing ? '/images/edits' : '/images/generations';
    context.emit({ type: 'PROGRESS', stage: 'PREPARING', message: 'Preparing CPA image request' });
    let body: BodyInit;
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` };
    if (editing) {
      const form = new FormData();
      form.set('model', request.modelId);
      form.set('prompt', request.prompt);
      form.set('n', '1');
      form.set('quality', request.output.quality);
      form.set('size', outputSize(request));
      form.set('output_format', 'png');
      for (const image of images) {
        const file = await readImage(image);
        form.append(
          'image[]',
          new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
          path.basename(image.localPath),
        );
      }
      if (mask) {
        const file = await readImage(mask);
        form.set('mask', new Blob([new Uint8Array(file.bytes)], { type: 'image/png' }), path.basename(mask.localPath));
      }
      body = form;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        model: request.modelId,
        prompt: request.prompt,
        n: 1,
        quality: request.output.quality,
        size: outputSize(request),
        output_format: 'png',
      });
    }
    context.emit({ type: 'PROGRESS', stage: 'UPLOADING', message: 'Submitting CPA image request' });
    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}${apiPath}`, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      throw new GenerationAdapterError({
        code: 'NETWORK',
        message: 'CPA image service could not be reached',
        cause: error,
      });
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (requestId) context.emit({ type: 'REQUEST_IDENTIFIED', providerRequestId: requestId });
    if (!response.ok) {
      const error = await tryDecodeProviderErrorJson(response, errorSchema, 'CPA Image').catch(() => null);
      const code =
        response.status === 401 || response.status === 403
          ? 'AUTH'
          : response.status === 429
            ? 'RATE_LIMITED'
            : response.status >= 500
              ? 'PROVIDER_UNAVAILABLE'
              : 'INVALID_REQUEST';
      throw new GenerationAdapterError({
        code,
        message: error?.error.message ?? `CPA image request failed with HTTP ${response.status}`,
        ...(error?.error.code ? { providerCode: error.error.code } : {}),
        details: { httpStatus: response.status, apiPath },
      });
    }
    context.emit({ type: 'PROGRESS', stage: 'DOWNLOADING', message: 'Receiving CPA image' });
    const payload = await decodeGenerationProviderResponseJson(response, responseSchema, 'CPA Image');
    const first = payload.data[0];
    if (!first?.b64_json)
      throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'CPA returned no image data' });
    const target = outputPath(this.libraryRoot, request.runId);
    await saveImage(target, decodeProviderImageBase64(first.b64_json, ['image/png']));
    context.emit({ type: 'PROGRESS', stage: 'FINALIZING', message: 'Saving CPA image' });
    return {
      kind: 'FILE' as const,
      outputPath: target,
      mimeType: 'image/png',
      ...(requestId ? { providerRequestId: requestId } : {}),
      responseMetadata: {
        requestedApiPath: apiPath,
        reportedQuality: payload.quality ?? null,
        reportedSize: payload.size ?? null,
        ...(payload.usage ? { usage: payload.usage } : {}),
      },
      ...(first.revised_prompt
        ? { providerReturnedDescriptions: [{ fieldName: 'revised_prompt', rawValue: first.revised_prompt }] }
        : {}),
    };
  }

  cleanup(runId: string) {
    void rm(path.dirname(outputPath(this.libraryRoot, runId)), { recursive: true, force: true }).catch((error) => {
      console.error('[cpa-image] failed to remove temporary output', error);
    });
  }
}
