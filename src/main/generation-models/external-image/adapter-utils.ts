import { rmSync } from 'node:fs';
import path from 'node:path';
import type { NormalizedGenerationMedia } from '@/main/generation-models/adapters/contracts';
import { GenerationAdapterError, type GenerationAdapterErrorCode } from '@/main/generation-models/adapters/errors';
import {
  MAX_GENERATED_IMAGE_BYTES,
  readValidatedReferenceImage,
  responseBufferWithinLimit,
  writeProviderImage,
} from '@/main/generation-models/adapters/provider-media';

const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;

export function mimeTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

export function mediaDataUrl(media: NormalizedGenerationMedia, maxBytes = MAX_REFERENCE_BYTES) {
  const declaredMimeType = media.mimeType || mimeTypeForPath(media.localPath);
  const { bytes, mimeType } = readValidatedReferenceImage(media.localPath, declaredMimeType, maxBytes);
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export function referenceBase64(media: NormalizedGenerationMedia, maxBytes = MAX_REFERENCE_BYTES) {
  const dataUrl = mediaDataUrl(media, maxBytes);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export function outputPath(libraryRoot: string, namespace: string, runId: string, extension = 'png') {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(runId)) {
    throw new GenerationAdapterError({ code: 'LOCAL_STATE', message: 'Unsafe generation run id' });
  }
  const root = path.resolve(libraryRoot);
  const output = path.resolve(root, 'temp', namespace, runId, `result.${extension}`);
  if (!output.startsWith(`${root}${path.sep}`)) {
    throw new GenerationAdapterError({ code: 'LOCAL_STATE', message: 'Unsafe generation output path' });
  }
  return output;
}

export function writeOutput(target: string, bytes: Buffer) {
  writeProviderImage(target, bytes, ['image/png']);
}

export function cleanupOutput(libraryRoot: string, namespace: string, runId: string) {
  rmSync(path.dirname(outputPath(libraryRoot, namespace, runId)), { recursive: true, force: true });
}

export async function fetchProvider(fetchImpl: typeof fetch, url: string, init: RequestInit, signal: AbortSignal) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new GenerationAdapterError({
      code: 'NETWORK',
      message: 'Image provider could not be reached',
      cause: error,
    });
  }
}

export function providerErrorCode(status: number): GenerationAdapterErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'INVALID_REQUEST';
}

export function providerError(options: {
  provider: string;
  status: number;
  requestId?: string;
  message?: unknown;
  code?: unknown;
}) {
  const message =
    typeof options.message === 'string' && options.message.trim()
      ? options.message.trim().slice(0, 1_000)
      : `${options.provider} image request failed with HTTP ${options.status}`;
  return new GenerationAdapterError({
    code: providerErrorCode(options.status),
    message,
    ...(typeof options.code === 'string' && options.code ? { providerCode: options.code } : {}),
    details: {
      httpStatus: options.status,
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
  });
}

function hostMatches(hostname: string, suffixes: readonly string[]) {
  const normalized = hostname.toLowerCase();
  return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function verifiedDownloadUrl(value: string | URL, allowedHostSuffixes: readonly string[], invalidMessage: string) {
  let parsed: URL;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: invalidMessage });
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (allowedHostSuffixes.length && !hostMatches(parsed.hostname, allowedHostSuffixes))
  ) {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: invalidMessage });
  }
  return parsed;
}

export async function downloadHttpsImage(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
  allowedHostSuffixes: readonly string[] = [],
) {
  let current = verifiedDownloadUrl(url, allowedHostSuffixes, 'Provider returned an unsafe image URL');
  let response: Response | null = null;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    response = await fetchProvider(
      fetchImpl,
      current.toString(),
      {
        method: 'GET',
        redirect: 'manual',
        signal,
      },
      signal,
    );
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || redirectCount === 5) {
      throw new GenerationAdapterError({
        code: 'NO_OUTPUT',
        message: 'Provider image download redirected too many times',
      });
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new GenerationAdapterError({
        code: 'NO_OUTPUT',
        message: 'Provider image download returned an invalid redirect',
      });
    }
    current = verifiedDownloadUrl(next, allowedHostSuffixes, 'Provider image download redirected to an unsafe URL');
  }
  if (!response) {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Provider returned no image response' });
  }
  if (response.url) {
    verifiedDownloadUrl(response.url, allowedHostSuffixes, 'Provider image download redirected to an unsafe URL');
  }
  if (!response.ok) {
    throw providerError({ provider: 'Provider output download', status: response.status });
  }
  const contentLength = Number(response.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new GenerationAdapterError({ code: 'NO_OUTPUT', message: 'Provider image output is too large' });
  }
  return responseBufferWithinLimit(response);
}
