import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { mkdtemp, open, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LibraryDatabase } from '@/main/database';
import {
  LocalQwenAsrSidecarError,
  type LocalQwenAsrCredentials,
  type LocalQwenAsrSidecarManager,
} from '@/main/extensions/local-qwen-asr/sidecar-manager';
import {
  LocalQwenProvider,
  LocalQwenProviderError,
  type LocalQwenAudioTranscription,
} from '@/main/video-transcript/local-qwen-provider';
import {
  videoDocumentTimedTranscriptContentSchema,
  type VideoDocumentDto,
  type VideoDocumentRevisionDto,
  type VideoDocumentTranscriptCue,
  type VideoDocumentTranscriptRecognitionErrorCode,
} from '@/shared/contracts/video-document';

// Qwen's feature extractor and vLLM speech endpoint both use a 30 second
// ceiling. A nominal 30 second FFmpeg WAV can decode a few milliseconds over
// that boundary, which makes vLLM split it again and concatenate multiple raw
// `language …<asr_text>` protocol envelopes. Keep a full second of margin.
const AUDIO_CHUNK_MS = 29_000;
const MAX_RECOGNITION_DURATION_MS = 12 * 60 * 60 * 1_000;
const MAX_WAV_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_TEXT_LENGTH = 2_000_000;
const MAX_CUE_TEXT_LENGTH = 10_000;
const FFMPEG_CHUNK_TIMEOUT_MS = 120_000;
const FFMPEG_FORCE_KILL_DELAY_MS = 5_000;
const TEMPORARY_DIRECTORY_PREFIX = 'aiy-qwen-asr-';

const qwenLanguageLocales: Readonly<Record<string, string>> = {
  chinese: 'zh',
  mandarin: 'zh',
  cantonese: 'yue',
  english: 'en',
  japanese: 'ja',
  korean: 'ko',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  russian: 'ru',
  arabic: 'ar',
  hindi: 'hi',
};

function transcriptLocale(language: string) {
  const locales = new Set(
    language
      .split(',')
      .map((value) => qwenLanguageLocales[value.trim().toLocaleLowerCase()])
      .filter((value): value is string => Boolean(value)),
  );
  return locales.size === 1 ? [...locales][0]! : 'und';
}

type RecognitionDatabase = Pick<LibraryDatabase, 'getVideoDocument' | 'resolveAssetFile' | 'saveVideoDocumentRevision'>;

export interface VideoDocumentTranscriptRecognitionInput {
  documentId: string;
  providerKey: 'qwen-local';
}

export interface VideoDocumentTranscriptRecognitionServiceProgress {
  documentId: string;
  completedChunks: number;
  totalChunks: number;
}

export interface VideoDocumentTranscriptRecognitionOptions {
  signal: AbortSignal;
  onProgress(progress: VideoDocumentTranscriptRecognitionServiceProgress): void;
}

interface RecognitionSnapshot {
  documentId: string;
  documentTitle: string;
  sourceDisplayName: string;
  sourceAssetId: string;
  sourceObjectHash: string;
  sourcePath: string;
  sourceByteSize: number;
  durationMs: number;
  branchId: string;
  expectedParentRevisionId: string | null;
}

const retryableByCode: Readonly<Record<VideoDocumentTranscriptRecognitionErrorCode, boolean>> = {
  NO_AUDIO: false,
  SOURCE_UNAVAILABLE: false,
  INPUT_TOO_LONG: false,
  LOCAL_SERVICE_NOT_CONFIGURED: false,
  LOCAL_SERVICE_UNAVAILABLE: true,
  LOCAL_MODEL_BUSY: true,
  FFMPEG_UNAVAILABLE: false,
  AUDIO_EXTRACTION_FAILED: true,
  AUTH_REJECTED: false,
  MODEL_UNAVAILABLE: false,
  RESPONSE_INVALID: false,
  NO_SPEECH: false,
  DOCUMENT_CHANGED: true,
  CANCELLED: false,
  UNKNOWN: false,
};

export class VideoDocumentTranscriptRecognitionError extends Error {
  constructor(
    readonly code: VideoDocumentTranscriptRecognitionErrorCode,
    readonly retryable: boolean,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'VideoDocumentTranscriptRecognitionError';
  }
}

function recognitionError(code: VideoDocumentTranscriptRecognitionErrorCode, message: string, cause?: unknown) {
  return new VideoDocumentTranscriptRecognitionError(code, retryableByCode[code], message, cause);
}

function normalizeRecognitionError(error: unknown) {
  if (error instanceof VideoDocumentTranscriptRecognitionError) return error;
  if (error instanceof LocalQwenAsrSidecarError) {
    const code =
      error.errorCode === 'RUNTIME_NOT_INSTALLED' || error.errorCode === 'MODEL_NOT_INSTALLED'
        ? 'LOCAL_SERVICE_NOT_CONFIGURED'
        : error.errorCode === 'UNSUPPORTED_PLATFORM' ||
            error.errorCode === 'WSL_UNAVAILABLE' ||
            error.errorCode === 'DISTRIBUTION_UNAVAILABLE'
          ? 'MODEL_UNAVAILABLE'
          : 'LOCAL_SERVICE_UNAVAILABLE';
    return recognitionError(code, 'Managed local Qwen ASR service is unavailable', error);
  }
  if (error instanceof LocalQwenProviderError) {
    return new VideoDocumentTranscriptRecognitionError(error.code, error.retryable, error.message, error);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return recognitionError('CANCELLED', 'Local transcript recognition was cancelled', error);
  }
  return recognitionError('UNKNOWN', 'Local transcript recognition failed', error);
}

export function videoDocumentTranscriptRecognitionFailure(error: unknown): {
  code: VideoDocumentTranscriptRecognitionErrorCode;
  retryable: boolean;
} {
  const normalized = normalizeRecognitionError(error);
  return { code: normalized.code, retryable: normalized.retryable };
}

function throwIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw recognitionError('CANCELLED', 'Local transcript recognition was cancelled');
}

function ffmpegExecutable() {
  const configured = process.env.AIY_FFMPEG_PATH?.trim();
  if (configured) return configured;
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', executable) : null;
  try {
    if (bundled && statSync(bundled).isFile()) return bundled;
  } catch {
    // Development resolves FFmpeg from PATH.
  }
  return executable;
}

function seconds(milliseconds: number) {
  return (milliseconds / 1_000).toFixed(3);
}

function extractAudioChunk(
  sourcePath: string,
  outputPath: string,
  startMs: number,
  durationMs: number,
  signal: AbortSignal,
) {
  throwIfCancelled(signal);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegExecutable(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-ss',
        seconds(startMs),
        '-i',
        sourcePath,
        '-t',
        seconds(durationMs),
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        '-y',
        outputPath,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    child.stderr.resume();

    let settled = false;
    let cancelled = false;
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, FFMPEG_CHUNK_TIMEOUT_MS);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const terminate = () => {
      if (child.exitCode === null) child.kill();
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          if (!settled && child.exitCode === null) child.kill('SIGKILL');
        }, FFMPEG_FORCE_KILL_DELAY_MS);
        forceKillTimer.unref?.();
      }
    };
    const onAbort = () => {
      cancelled = true;
      terminate();
    };

    signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (cancelled || signal.aborted) {
        finish(recognitionError('CANCELLED', 'Local transcript recognition was cancelled', error));
      } else if (error.code === 'ENOENT') {
        finish(recognitionError('FFMPEG_UNAVAILABLE', 'FFmpeg is unavailable', error));
      } else {
        finish(recognitionError('AUDIO_EXTRACTION_FAILED', 'Audio extraction could not start', error));
      }
    });
    child.once('close', (code) => {
      if (cancelled || signal.aborted) {
        finish(recognitionError('CANCELLED', 'Local transcript recognition was cancelled'));
      } else if (timedOut) {
        finish(recognitionError('AUDIO_EXTRACTION_FAILED', 'Audio extraction timed out'));
      } else if (code !== 0) {
        finish(recognitionError('AUDIO_EXTRACTION_FAILED', 'Audio extraction failed'));
      } else {
        finish();
      }
    });
    if (signal.aborted) onAbort();
  });
}

async function validateWaveFile(filePath: string) {
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch (error) {
    throw recognitionError('AUDIO_EXTRACTION_FAILED', 'Extracted audio is unavailable', error);
  }
  if (!metadata.isFile() || metadata.size < 44 || metadata.size > MAX_WAV_CHUNK_BYTES) {
    throw recognitionError('AUDIO_EXTRACTION_FAILED', 'Extracted audio has an invalid size');
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, 'r');
    const header = Buffer.alloc(12);
    const result = await handle.read(header, 0, header.length, 0);
    if (
      result.bytesRead !== header.length ||
      header.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      header.subarray(8, 12).toString('ascii') !== 'WAVE'
    ) {
      throw recognitionError('AUDIO_EXTRACTION_FAILED', 'Extracted audio is not a valid WAVE file');
    }
  } catch (error) {
    if (error instanceof VideoDocumentTranscriptRecognitionError) throw error;
    throw recognitionError('AUDIO_EXTRACTION_FAILED', 'Extracted audio could not be validated', error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function safeProgress(
  callback: VideoDocumentTranscriptRecognitionOptions['onProgress'],
  progress: VideoDocumentTranscriptRecognitionServiceProgress,
) {
  try {
    callback(progress);
  } catch {
    // Progress observation cannot change recognition output.
  }
}

function sourceFileName(snapshot: RecognitionSnapshot) {
  const raw = (snapshot.sourceDisplayName || snapshot.documentTitle || 'Video')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bounded = Array.from(raw || 'Video')
    .slice(0, 260)
    .join('');
  return `${bounded} [Qwen3-ASR]`;
}

async function removeTemporaryDirectory(directory: string) {
  const temporaryRoot = path.resolve(tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith(TEMPORARY_DIRECTORY_PREFIX)) {
    throw recognitionError('UNKNOWN', 'Refused to clean an unexpected temporary directory');
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export class VideoDocumentTranscriptRecognitionService {
  private readonly pending = new Map<string, Promise<VideoDocumentRevisionDto>>();

  constructor(
    private readonly database: RecognitionDatabase,
    private readonly sidecar: Pick<LocalQwenAsrSidecarManager, 'credentials'>,
    private readonly provider: LocalQwenProvider = new LocalQwenProvider(),
  ) {}

  recognize(
    input: VideoDocumentTranscriptRecognitionInput,
    options: VideoDocumentTranscriptRecognitionOptions,
  ): Promise<VideoDocumentRevisionDto> {
    if (this.pending.size > 0) {
      return Promise.reject(recognitionError('LOCAL_MODEL_BUSY', 'The local Qwen ASR model is already in use'));
    }

    let snapshot: RecognitionSnapshot;
    let credentials: LocalQwenAsrCredentials | null;
    try {
      if (input.providerKey !== 'qwen-local') {
        throw recognitionError('MODEL_UNAVAILABLE', 'The requested transcript recognition provider is unavailable');
      }
      snapshot = this.captureSnapshot(input.documentId);
      credentials = this.sidecar.credentials();
      if (!credentials?.verified) {
        throw recognitionError('LOCAL_SERVICE_NOT_CONFIGURED', 'Local Qwen ASR is not configured');
      }
      throwIfCancelled(options.signal);
    } catch (error) {
      return Promise.reject(normalizeRecognitionError(error));
    }

    const operation = this.run(snapshot, credentials, options)
      .catch((error: unknown) => {
        throw normalizeRecognitionError(error);
      })
      .finally(() => this.pending.delete(snapshot.branchId));
    this.pending.set(snapshot.branchId, operation);
    return operation;
  }

  private captureSnapshot(documentId: string): RecognitionSnapshot {
    let document: VideoDocumentDto;
    try {
      document = this.database.getVideoDocument(documentId);
    } catch (error) {
      throw recognitionError('SOURCE_UNAVAILABLE', 'The video document is unavailable', error);
    }
    if (document.source.audio.status === 'NO_AUDIO') {
      throw recognitionError('NO_AUDIO', 'The video has no audio track');
    }
    if (document.source.audio.status !== 'HAS_AUDIO' || document.source.audio.trackCount < 1) {
      throw recognitionError('SOURCE_UNAVAILABLE', 'The video audio track is unavailable');
    }
    if (!document.source.available || !document.source.asset.mimeType.startsWith('video/')) {
      throw recognitionError('SOURCE_UNAVAILABLE', 'The source video is unavailable');
    }
    const source = this.database.resolveAssetFile(document.source.asset.id);
    if (!source || !source.mimeType.startsWith('video/')) {
      throw recognitionError('SOURCE_UNAVAILABLE', 'The source video file is unavailable');
    }
    try {
      const metadata = statSync(source.absolutePath);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size !== document.source.asset.byteSize) {
        throw recognitionError('SOURCE_UNAVAILABLE', 'The source video file changed');
      }
    } catch (error) {
      if (error instanceof VideoDocumentTranscriptRecognitionError) throw error;
      throw recognitionError('SOURCE_UNAVAILABLE', 'The source video file is unavailable', error);
    }
    if (document.source.asset.durationMs > MAX_RECOGNITION_DURATION_MS) {
      throw recognitionError('INPUT_TOO_LONG', 'The video is too long for local transcript recognition');
    }
    const branch = document.branches.find((candidate) => candidate.role === 'CLEAN_TRANSCRIPT');
    if (!branch) throw recognitionError('UNKNOWN', 'The transcript branch is unavailable');
    return {
      documentId,
      documentTitle: document.title,
      sourceDisplayName: document.source.displayName,
      sourceAssetId: source.assetId,
      sourceObjectHash: source.objectHash,
      sourcePath: source.absolutePath,
      sourceByteSize: document.source.asset.byteSize,
      durationMs: document.source.asset.durationMs,
      branchId: branch.id,
      expectedParentRevisionId: branch.latestDraftRevisionId,
    };
  }

  private async run(
    snapshot: RecognitionSnapshot,
    credentials: LocalQwenAsrCredentials,
    options: VideoDocumentTranscriptRecognitionOptions,
  ) {
    throwIfCancelled(options.signal);
    const totalChunks = Math.ceil(snapshot.durationMs / AUDIO_CHUNK_MS);
    safeProgress(options.onProgress, { documentId: snapshot.documentId, completedChunks: 0, totalChunks });

    let temporaryDirectory: string;
    try {
      temporaryDirectory = await mkdtemp(path.join(tmpdir(), TEMPORARY_DIRECTORY_PREFIX));
    } catch (error) {
      throw recognitionError('AUDIO_EXTRACTION_FAILED', 'A temporary audio workspace could not be created', error);
    }

    let cues: VideoDocumentTranscriptCue[];
    try {
      cues = await this.transcribeChunks(snapshot, credentials, temporaryDirectory, totalChunks, options);
    } catch (error) {
      try {
        await removeTemporaryDirectory(temporaryDirectory);
      } catch (cleanupError) {
        throw recognitionError(
          'UNKNOWN',
          'The temporary audio workspace could not be removed',
          new AggregateError([error, cleanupError]),
        );
      }
      throw error;
    }
    try {
      await removeTemporaryDirectory(temporaryDirectory);
    } catch (error) {
      throw recognitionError('UNKNOWN', 'The temporary audio workspace could not be removed', error);
    }

    throwIfCancelled(options.signal);
    if (!cues.length) throw recognitionError('NO_SPEECH', 'No speech was detected in the video');
    const rawText = cues.map((cue) => cue.text).join('\n');
    if (!rawText || rawText.length > MAX_TRANSCRIPT_TEXT_LENGTH) {
      throw recognitionError('RESPONSE_INVALID', 'The recognized transcript exceeded its bounded size');
    }
    const content = videoDocumentTimedTranscriptContentSchema.safeParse({
      schemaVersion: 2,
      format: 'TIMED_TRANSCRIPT',
      transcriptBasis: 'AUDIO_TRANSCRIPT',
      textTreatment: 'VERBATIM',
      sourceFileName: sourceFileName(snapshot),
      sourceHash: createHash('sha256').update(rawText, 'utf8').digest('hex'),
      rawText,
      cues,
    });
    if (!content.success) {
      throw recognitionError('RESPONSE_INVALID', 'The recognized transcript is invalid', content.error);
    }

    this.verifySnapshot(snapshot);
    try {
      return this.database.saveVideoDocumentRevision(
        {
          branchId: snapshot.branchId,
          expectedParentRevisionId: snapshot.expectedParentRevisionId,
          content: content.data,
        },
        'AGENT',
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'Document revision changed before it could be saved') {
        throw recognitionError('DOCUMENT_CHANGED', 'The transcript changed during recognition', error);
      }
      throw error;
    }
  }

  private async transcribeChunks(
    snapshot: RecognitionSnapshot,
    credentials: LocalQwenAsrCredentials,
    temporaryDirectory: string,
    totalChunks: number,
    options: VideoDocumentTranscriptRecognitionOptions,
  ) {
    const cues: VideoDocumentTranscriptCue[] = [];
    let transcriptLength = 0;
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      throwIfCancelled(options.signal);
      const startTimestampMs = chunkIndex * AUDIO_CHUNK_MS;
      const endTimestampMs = Math.min(snapshot.durationMs, startTimestampMs + AUDIO_CHUNK_MS);
      const chunkPath = path.join(temporaryDirectory, `chunk-${String(chunkIndex + 1).padStart(5, '0')}.wav`);
      await extractAudioChunk(
        snapshot.sourcePath,
        chunkPath,
        startTimestampMs,
        endTimestampMs - startTimestampMs,
        options.signal,
      );
      await validateWaveFile(chunkPath);

      let transcription: LocalQwenAudioTranscription | null;
      try {
        transcription = await this.provider.transcribe({ audioPath: chunkPath, credentials }, options.signal);
      } finally {
        await unlink(chunkPath).catch(() => undefined);
      }
      throwIfCancelled(options.signal);
      if (transcription) {
        if (transcription.text.length > MAX_CUE_TEXT_LENGTH) {
          throw recognitionError('RESPONSE_INVALID', 'A recognized transcript cue exceeded its bounded size');
        }
        transcriptLength += transcription.text.length + (cues.length ? 1 : 0);
        if (transcriptLength > MAX_TRANSCRIPT_TEXT_LENGTH) {
          throw recognitionError('RESPONSE_INVALID', 'The recognized transcript exceeded its bounded size');
        }
        cues.push({
          sourceIndex: cues.length + 1,
          startTimestampMs,
          endTimestampMs,
          text: transcription.text,
          textLocale: transcriptLocale(transcription.language),
          localizations: [],
        });
      }
      safeProgress(options.onProgress, {
        documentId: snapshot.documentId,
        completedChunks: chunkIndex + 1,
        totalChunks,
      });
    }
    return cues;
  }

  private verifySnapshot(snapshot: RecognitionSnapshot) {
    let current: VideoDocumentDto;
    try {
      current = this.database.getVideoDocument(snapshot.documentId);
    } catch (error) {
      throw recognitionError('DOCUMENT_CHANGED', 'The video document changed during recognition', error);
    }
    const branch = current.branches.find((candidate) => candidate.role === 'CLEAN_TRANSCRIPT');
    const source = this.database.resolveAssetFile(current.source.asset.id);
    if (
      current.source.asset.id !== snapshot.sourceAssetId ||
      current.source.asset.byteSize !== snapshot.sourceByteSize ||
      !source ||
      source.objectHash !== snapshot.sourceObjectHash ||
      branch?.id !== snapshot.branchId ||
      branch.latestDraftRevisionId !== snapshot.expectedParentRevisionId
    ) {
      throw recognitionError('DOCUMENT_CHANGED', 'The video document changed during recognition');
    }
  }
}
