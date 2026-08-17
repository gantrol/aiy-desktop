import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { LocalQwenAsrCredentials } from '@/main/extensions/local-qwen-asr/sidecar-manager';
import { ProviderResponseError, decodeProviderResponseJson } from '@/main/providers/provider-response';
import type { VideoDocumentTranscriptRecognitionErrorCode } from '@/shared/contracts/video-document';

const MAX_TRANSCRIPTION_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPTION_AUDIO_BYTES = 2 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 5 * 60_000;
const MAX_QWEN_PROTOCOL_SEGMENTS = 64;
const qwenProtocolHeaderPattern = /language ([^<\r\n]{1,100})(?:\r?\n[^<\r\n]{0,200}){0,8}\r?\n?<asr_text>/giu;

const qwenTranscriptionResponseSchema = z
  .object({
    text: z.string().min(1).max(2_000_000),
    usage: z
      .object({
        type: z.literal('duration'),
        seconds: z.number().finite().nonnegative(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface LocalQwenAudioTranscription {
  language: string;
  text: string;
  durationSeconds: number | null;
}

export interface LocalQwenAudioTranscriptionRequest {
  audioPath: string;
  credentials: LocalQwenAsrCredentials;
}

export class LocalQwenProviderError extends Error {
  constructor(
    readonly code: VideoDocumentTranscriptRecognitionErrorCode,
    readonly retryable: boolean,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'LocalQwenProviderError';
  }
}

function providerError(
  code: VideoDocumentTranscriptRecognitionErrorCode,
  retryable: boolean,
  message: string,
  cause?: unknown,
) {
  return new LocalQwenProviderError(code, retryable, message, cause);
}

function httpFailure(status: number) {
  if (status === 401 || status === 403) {
    return providerError('AUTH_REJECTED', false, 'The local Qwen ASR service rejected its credentials');
  }
  if (status === 404) {
    return providerError('MODEL_UNAVAILABLE', false, 'The configured local Qwen ASR model is unavailable');
  }
  if (status === 409 || status === 423 || status === 429) {
    return providerError('LOCAL_MODEL_BUSY', true, 'The local Qwen ASR model is busy');
  }
  if (status === 413) {
    return providerError('INPUT_TOO_LONG', false, 'The local Qwen ASR service rejected an oversized audio input');
  }
  if (status >= 500) {
    return providerError('LOCAL_SERVICE_UNAVAILABLE', true, 'The local Qwen ASR service is unavailable');
  }
  return providerError('RESPONSE_INVALID', false, `The local Qwen ASR service rejected the request (HTTP ${status})`);
}

function parseQwenProtocol(value: string, durationSeconds: number | null): LocalQwenAudioTranscription | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const markerCount = normalized.match(/<asr_text>/giu)?.length ?? 0;
  if (markerCount === 0) {
    // qwen-asr's official parser treats an untagged response as a plain
    // transcription. Keep protocol-shaped control tokens out of revisions.
    if (normalized.includes('<|') || normalized.toLocaleLowerCase().includes('<asr_')) {
      throw providerError('RESPONSE_INVALID', false, 'The local Qwen ASR service returned an invalid transcription');
    }
    return { language: '', text: normalized, durationSeconds };
  }
  if (markerCount > MAX_QWEN_PROTOCOL_SEGMENTS) {
    throw providerError('RESPONSE_INVALID', false, 'The local Qwen ASR service returned too many protocol segments');
  }

  const headers = [...normalized.matchAll(qwenProtocolHeaderPattern)];
  if (headers.length !== markerCount || headers[0]?.index !== 0) {
    throw providerError('RESPONSE_INVALID', false, 'The local Qwen ASR service returned unmatched protocol markers');
  }

  const texts: string[] = [];
  const languages: string[] = [];
  for (const [index, header] of headers.entries()) {
    const language = header[1]!.trim();
    if (!language || language.length > 100 || language.includes('<')) {
      throw providerError('RESPONSE_INVALID', false, 'The local Qwen ASR service returned an invalid language');
    }
    const textStart = header.index! + header[0].length;
    const textEnd = headers[index + 1]?.index ?? normalized.length;
    const text = normalized.slice(textStart, textEnd).trim();
    if (text.includes('<|') || text.toLocaleLowerCase().includes('<asr_')) {
      throw providerError('RESPONSE_INVALID', false, 'The local Qwen ASR service leaked a protocol control token');
    }
    if (!/^none$/i.test(language) && !languages.includes(language)) languages.push(language);
    if (text) texts.push(text);
  }
  const text = texts.join('\n');
  return text ? { language: languages.join(','), text, durationSeconds } : null;
}

export class LocalQwenProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async transcribe(
    request: LocalQwenAudioTranscriptionRequest,
    signal: AbortSignal,
  ): Promise<LocalQwenAudioTranscription | null> {
    if (signal.aborted) throw providerError('CANCELLED', false, 'Local transcription was cancelled');

    let audio: Blob;
    try {
      const audioBytes = await readFile(request.audioPath, { signal });
      if (audioBytes.length < 44 || audioBytes.length > MAX_TRANSCRIPTION_AUDIO_BYTES) {
        throw providerError('AUDIO_EXTRACTION_FAILED', false, 'The extracted audio chunk has an invalid size');
      }
      audio = new Blob([new Uint8Array(audioBytes)], { type: 'audio/wav' });
    } catch (error) {
      if (error instanceof LocalQwenProviderError) throw error;
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw providerError('CANCELLED', false, 'Local transcription was cancelled', error);
      }
      throw providerError('AUDIO_EXTRACTION_FAILED', true, 'The extracted audio chunk is unavailable', error);
    }
    if (signal.aborted) throw providerError('CANCELLED', false, 'Local transcription was cancelled');

    const form = new FormData();
    form.append('file', audio, 'chunk.wav');
    form.append('model', request.credentials.modelId);
    form.append('response_format', 'json');

    const requestController = new AbortController();
    let timedOut = false;
    const cancelRequest = () => requestController.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, TRANSCRIPTION_TIMEOUT_MS);
    timeout.unref?.();
    signal.addEventListener('abort', cancelRequest, { once: true });
    if (signal.aborted) cancelRequest();
    try {
      const response = await this.fetchImpl(`${request.credentials.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${request.credentials.apiKey}`,
        },
        body: form,
        redirect: 'error',
        signal: requestController.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw httpFailure(response.status);
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase();
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined);
        throw providerError('RESPONSE_INVALID', false, 'The local Qwen ASR service returned a non-JSON response');
      }
      const envelope = await decodeProviderResponseJson(response, qwenTranscriptionResponseSchema, {
        provider: 'Local Qwen ASR transcription',
        maxBytes: MAX_TRANSCRIPTION_RESPONSE_BYTES,
      });
      return parseQwenProtocol(envelope.text, envelope.usage?.seconds ?? null);
    } catch (error) {
      if (error instanceof LocalQwenProviderError) throw error;
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        if (timedOut && !signal.aborted) {
          throw providerError('LOCAL_SERVICE_UNAVAILABLE', true, 'The local Qwen ASR request timed out', error);
        }
        throw providerError('CANCELLED', false, 'Local transcription was cancelled', error);
      }
      if (error instanceof ProviderResponseError) {
        throw providerError(
          'RESPONSE_INVALID',
          false,
          'The local Qwen ASR service returned an invalid response',
          error,
        );
      }
      throw providerError('LOCAL_SERVICE_UNAVAILABLE', true, 'The local Qwen ASR service is unavailable', error);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancelRequest);
    }
  }
}
