import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  VideoDocumentFrameCaptureInput,
  VideoDocumentFrameCaptureResult,
  VideoKeyChangeCandidateReason,
  VideoKeyChangeExtractInput,
  VideoKeyChangeResultDto,
} from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import { mediaUrl as assetMediaUrl } from '@/main/database/core/values';
import { imageDimensions } from '@/main/media/image-dimensions';
import {
  appendBoundedStderr,
  ffmpegExecutable,
  ffmpegFailure,
  ffmpegSampleInterval,
  frameCaptureTerminationError,
  isPathInside,
  keyChangeAbortError,
  keyChangeTerminationError,
  throwIfFrameCaptureCancelled,
  throwIfKeyChangeCancelled,
  waitForKeyChangeFfmpeg,
} from '@/main/video-documents/key-change-ffmpeg';

const algorithmVersion = 1 as const;
const scanWidth = 160;
const scanHeight = 90;
const scanFrameBytes = scanWidth * scanHeight;
const maximumScanFrames = 1_800;
const maximumChangeCandidates = 14;
const maximumCandidateCount = 24;
const maximumManifestBytes = 128 * 1024;
const maximumCandidateImageBytes = 4 * 1024 * 1024;
const keyChangeExtractionTimeoutMs = 20 * 60_000;
const frameCaptureTimeoutMs = 30_000;
const ffmpegTerminationGraceMs = 2_000;
const maximumConcurrentFfmpegOperations = 1;
const evidenceRelativeRoot = path.join('temp', 'video-key-changes', `v${algorithmVersion}`);

const manifestCandidateSchema = z
  .object({
    id: z.string().min(1).max(200),
    sampleIndex: z.number().int().nonnegative(),
    timestampMs: z.number().int().nonnegative(),
    score: z.number().finite().nonnegative(),
    reason: z.enum(['SOURCE_START', 'SOURCE_END', 'VISUAL_CHANGE', 'COVERAGE']),
    fileName: z.string().regex(/^frame-\d{3}\.jpg$/),
    width: z.number().int().positive().max(960),
    height: z.number().int().positive().max(960),
  })
  .strict();

const manifestSchema = z
  .object({
    extractionId: z.string().regex(/^[a-f0-9]{64}$/),
    documentId: z.string().min(1).max(200),
    sourceAssetId: z.string().min(1).max(200),
    sourceObjectHash: z.string().regex(/^[a-f0-9]{64}$/),
    algorithmVersion: z.literal(algorithmVersion),
    durationMs: z.number().int().positive(),
    sampleIntervalMs: z.number().int().positive(),
    scannedFrameCount: z
      .number()
      .int()
      .positive()
      .max(maximumScanFrames + 2),
    candidates: z.array(manifestCandidateSchema).min(1).max(maximumCandidateCount),
    createdAt: z.string().min(1).max(100),
  })
  .strict();

type VideoKeyChangeManifest = z.infer<typeof manifestSchema>;
type VideoKeyChangeDatabase = Pick<
  LibraryDatabase,
  'libraryRoot' | 'getVideoDocument' | 'resolveAssetFile' | 'ensurePrivateVideoDocumentEvidenceImage'
>;

export interface VideoKeyChangeModelEvidence {
  extractionId: string;
  sourceAssetId: string;
  sourceObjectHash: string;
  candidates: Array<{
    id: string;
    timestampMs: number;
    score: number;
    reason: VideoKeyChangeCandidateReason;
    width: number;
    height: number;
    filePath: string;
  }>;
}

interface CapturedVideoSource {
  documentId: string;
  sourceAssetId: string;
  sourceObjectHash: string;
  sourcePath: string;
  libraryRoot: string;
  durationMs: number;
  extractionId: string;
  outputDirectory: string;
  manifestPath: string;
}

interface PendingVideoKeyChangeExtraction {
  controller: AbortController;
  promise: Promise<VideoKeyChangeResultDto>;
  consumers: number;
  completed: boolean;
}

export interface VideoKeyChangeSample {
  sampleIndex: number;
  timestampMs: number;
  score: number;
  reason: VideoKeyChangeCandidateReason;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function scoreFrameChange(previous: Buffer, current: Buffer) {
  const firstRow = 2;
  const lastRow = Math.floor(scanHeight * 0.78);
  let differenceTotal = 0;
  let materiallyChanged = 0;
  let compared = 0;
  for (let row = firstRow; row < lastRow; row += 1) {
    const rowOffset = row * scanWidth;
    for (let column = 2; column < scanWidth - 2; column += 1) {
      const offset = rowOffset + column;
      const difference = Math.abs(current[offset]! - previous[offset]!);
      differenceTotal += difference;
      if (difference >= 16) materiallyChanged += 1;
      compared += 1;
    }
  }
  if (!compared) return 0;
  return differenceTotal / compared + (materiallyChanged / compared) * 24;
}

function addSample(
  samples: Map<number, VideoKeyChangeSample>,
  sampleIndex: number,
  reason: VideoKeyChangeCandidateReason,
  scores: number[],
  sampleIntervalMs: number,
  durationMs: number,
) {
  const existing = samples.get(sampleIndex);
  const priority: Record<VideoKeyChangeCandidateReason, number> = {
    SOURCE_START: 4,
    SOURCE_END: 3,
    VISUAL_CHANGE: 2,
    COVERAGE: 1,
  };
  if (existing && priority[existing.reason] >= priority[reason]) return;
  samples.set(sampleIndex, {
    sampleIndex,
    timestampMs: Math.min(durationMs, sampleIndex * sampleIntervalMs),
    score: Number((scores[sampleIndex] ?? 0).toFixed(3)),
    reason,
  });
}

/** Selects bounded visual-change and coverage candidates from a complete low-resolution scan. */
export function selectVideoKeyChangeSamples(
  scores: number[],
  sampleIntervalMs: number,
  durationMs: number,
): VideoKeyChangeSample[] {
  if (!scores.length) throw new Error('VIDEO_KEY_CHANGES_EMPTY_SCAN');
  const lastSampleIndex = scores.length - 1;
  const samples = new Map<number, VideoKeyChangeSample>();
  addSample(samples, 0, 'SOURCE_START', scores, sampleIntervalMs, durationMs);
  if (lastSampleIndex > 0) {
    addSample(samples, lastSampleIndex, 'SOURCE_END', scores, sampleIntervalMs, durationMs);
  }

  const changedScores = scores.slice(1);
  const baseline = median(changedScores);
  const deviation = median(changedScores.map((score) => Math.abs(score - baseline)));
  const threshold = Math.max(4, baseline + Math.max(0.75, deviation) * 2.5);
  const rankedLocalPeaks: Array<{ sampleIndex: number; score: number }> = [];
  for (let sampleIndex = 1; sampleIndex < lastSampleIndex; sampleIndex += 1) {
    const score = scores[sampleIndex]!;
    if (score < threshold || score < scores[sampleIndex - 1]! || score <= scores[sampleIndex + 1]!) continue;
    rankedLocalPeaks.push({ sampleIndex, score });
  }

  if (rankedLocalPeaks.length < 4) {
    const existing = new Set(rankedLocalPeaks.map((candidate) => candidate.sampleIndex));
    for (let sampleIndex = 1; sampleIndex < lastSampleIndex; sampleIndex += 1) {
      if (existing.has(sampleIndex) || scores[sampleIndex]! < Math.max(3, baseline + deviation)) continue;
      rankedLocalPeaks.push({ sampleIndex, score: scores[sampleIndex]! });
    }
  }

  const minimumChangeGapMs = Math.max(5_000, sampleIntervalMs * 2);
  const selectedChangeTimes: number[] = [];
  for (const peak of rankedLocalPeaks.sort((left, right) => right.score - left.score)) {
    const timestampMs = peak.sampleIndex * sampleIntervalMs;
    if (selectedChangeTimes.some((selected) => Math.abs(selected - timestampMs) < minimumChangeGapMs)) continue;
    addSample(samples, peak.sampleIndex, 'VISUAL_CHANGE', scores, sampleIntervalMs, durationMs);
    selectedChangeTimes.push(timestampMs);
    if (selectedChangeTimes.length >= maximumChangeCandidates) break;
  }

  const minimumCoverageGapMs = Math.max(4_000, sampleIntervalMs * 2);
  for (let part = 1; part < 8; part += 1) {
    const sampleIndex = Math.round((lastSampleIndex * part) / 8);
    if (sampleIndex <= 0 || sampleIndex >= lastSampleIndex) continue;
    const timestampMs = sampleIndex * sampleIntervalMs;
    if (
      [...samples.values()].some((candidate) => Math.abs(candidate.timestampMs - timestampMs) < minimumCoverageGapMs)
    ) {
      continue;
    }
    addSample(samples, sampleIndex, 'COVERAGE', scores, sampleIntervalMs, durationMs);
  }

  return [...samples.values()]
    .sort((left, right) => left.sampleIndex - right.sampleIndex)
    .slice(0, maximumCandidateCount);
}

export function selectVideoKeyChangeModelCandidates<T extends { id: string; timestampMs: number; score: number }>(
  candidates: readonly T[],
  maximum = 8,
) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8) {
    throw new Error('VIDEO_KEY_CHANGES_INVALID_MODEL_CANDIDATE_LIMIT');
  }
  const ordered = [...candidates].sort(
    (left, right) =>
      left.timestampMs - right.timestampMs || right.score - left.score || left.id.localeCompare(right.id),
  );
  if (ordered.length <= maximum) return ordered;

  const selected = new Map<string, T>();
  const add = (candidate: T) => selected.set(candidate.id, candidate);
  add(ordered[0]!);
  if (maximum > 1) add(ordered.at(-1)!);
  const durationMs = Math.max(ordered.at(-1)!.timestampMs, 1);
  for (let part = 1; selected.size < maximum && part < maximum - 1; part += 1) {
    const target = (durationMs * part) / (maximum - 1);
    const nearest = ordered
      .filter((candidate) => !selected.has(candidate.id))
      .sort(
        (left, right) =>
          Math.abs(left.timestampMs - target) - Math.abs(right.timestampMs - target) ||
          right.score - left.score ||
          left.id.localeCompare(right.id),
      )[0];
    if (nearest) add(nearest);
  }
  for (const candidate of ordered
    .filter((item) => !selected.has(item.id))
    .sort((left, right) => right.score - left.score || left.timestampMs - right.timestampMs)) {
    if (selected.size >= maximum) break;
    add(candidate);
  }
  return [...selected.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id),
  );
}

async function scanVideo(sourcePath: string, sampleIntervalMs: number, signal?: AbortSignal) {
  throwIfKeyChangeCancelled(signal);
  const scores: number[] = [];
  const frameFilter = [
    `fps=1000/${sampleIntervalMs}`,
    `scale=${scanWidth}:${scanHeight}:force_original_aspect_ratio=decrease`,
    `pad=${scanWidth}:${scanHeight}:(ow-iw)/2:(oh-ih)/2`,
    'format=gray',
  ].join(',');
  const child = spawn(
    ffmpegExecutable(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      sourcePath,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-vf',
      frameFilter,
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let previous: Buffer | null = null;
  let pending: Buffer = Buffer.alloc(0);
  let stderr = '';
  let scanError: Error | null = null;

  child.stdout.on('data', (chunk: Buffer) => {
    if (scanError) return;
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= scanFrameBytes) {
      const frame = pending.subarray(0, scanFrameBytes);
      pending = pending.subarray(scanFrameBytes);
      scores.push(previous ? scoreFrameChange(previous, frame) : 0);
      previous = Buffer.from(frame);
      if (scores.length > maximumScanFrames + 2) {
        scanError = new Error('VIDEO_KEY_CHANGES_SCAN_LIMIT_EXCEEDED');
        child.kill();
        break;
      }
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = appendBoundedStderr(stderr, chunk);
  });

  await waitForKeyChangeFfmpeg(
    child,
    signal,
    () => ffmpegFailure(stderr),
    () => {
      if (scanError) return scanError;
      return pending.length ? new Error('VIDEO_KEY_CHANGES_INCOMPLETE_FRAME') : null;
    },
  );
  throwIfKeyChangeCancelled(signal);
  if (!scores.length) throw new Error('VIDEO_KEY_CHANGES_NO_VIDEO_FRAMES');
  return scores;
}

async function extractCandidateImages(
  sourcePath: string,
  outputDirectory: string,
  samples: VideoKeyChangeSample[],
  sampleIntervalMs: number,
  signal?: AbortSignal,
) {
  throwIfKeyChangeCancelled(signal);
  const selection = samples.map((sample) => `eq(n\\,${sample.sampleIndex})`).join('+');
  const frameFilter = [
    `fps=1000/${sampleIntervalMs}`,
    `select=${selection}`,
    'scale=960:960:force_original_aspect_ratio=decrease',
  ].join(',');
  const child = spawn(
    ffmpegExecutable(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      sourcePath,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-vf',
      frameFilter,
      '-fps_mode',
      'vfr',
      '-frames:v',
      String(samples.length),
      '-q:v',
      '3',
      '-start_number',
      '1',
      path.join(outputDirectory, 'frame-%03d.jpg'),
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = appendBoundedStderr(stderr, chunk);
  });
  await waitForKeyChangeFfmpeg(child, signal, () => ffmpegFailure(stderr));
  throwIfKeyChangeCancelled(signal);

  const frames: Array<{ fileName: string; width: number; height: number }> = [];
  for (const [index] of samples.entries()) {
    throwIfKeyChangeCancelled(signal);
    const fileName = `frame-${String(index + 1).padStart(3, '0')}.jpg`;
    const filePath = path.join(outputDirectory, fileName);
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size < 128 || metadata.size > maximumCandidateImageBytes) {
      throw new Error('VIDEO_KEY_CHANGES_INVALID_FRAME_SIZE');
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath, { signal });
    } catch (error) {
      if (signal?.aborted) throw keyChangeAbortError(signal);
      throw error;
    }
    const dimensions = imageDimensions(bytes, '.jpg');
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      throw new Error('VIDEO_KEY_CHANGES_INVALID_FRAME');
    }
    if (dimensions.width > 960 || dimensions.height > 960) {
      throw new Error('VIDEO_KEY_CHANGES_FRAME_DIMENSIONS_EXCEEDED');
    }
    frames.push({ fileName, ...dimensions });
  }
  return frames;
}

async function extractFrameAtTimestamp(
  sourcePath: string,
  outputPath: string,
  timestampMs: number,
  signal?: AbortSignal,
) {
  throwIfFrameCaptureCancelled(signal);
  const child = spawn(
    ffmpegExecutable(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-ss',
      (timestampMs / 1_000).toFixed(3),
      '-i',
      sourcePath,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-frames:v',
      '1',
      '-vf',
      'scale=960:960:force_original_aspect_ratio=decrease',
      '-q:v',
      '2',
      outputPath,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = appendBoundedStderr(stderr, chunk);
  });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let processError: NodeJS.ErrnoException | null = null;
    let terminationReason: 'cancelled' | 'timeout' | null = null;
    let forceTerminationTimer: NodeJS.Timeout | null = null;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTerminationTimer) clearTimeout(forceTerminationTimer);
      signal?.removeEventListener('abort', cancel);
      operation();
    };
    const terminate = (reason: 'cancelled' | 'timeout') => {
      if (terminationReason) return;
      terminationReason = reason;
      child.kill();
      forceTerminationTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, ffmpegTerminationGraceMs);
      forceTerminationTimer.unref();
    };
    const cancel = () => terminate('cancelled');
    const timeout = setTimeout(() => terminate('timeout'), frameCaptureTimeoutMs);
    timeout.unref();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.once('error', (error: NodeJS.ErrnoException) => {
      processError = error;
    });
    child.once('close', (code) => {
      finish(() => {
        if (terminationReason) reject(frameCaptureTerminationError(terminationReason));
        else if (processError?.code === 'ENOENT') reject(new Error('VIDEO_KEY_CHANGES_FFMPEG_UNAVAILABLE'));
        else if (processError) reject(new Error(`VIDEO_KEY_CHANGES_FFMPEG_START_FAILED: ${processError.message}`));
        else if (code !== 0) reject(ffmpegFailure(stderr));
        else resolve();
      });
    });
  });
  throwIfFrameCaptureCancelled(signal);
  const metadata = await stat(outputPath);
  if (!metadata.isFile() || metadata.size < 128 || metadata.size > maximumCandidateImageBytes) {
    throw new Error('VIDEO_DOCUMENT_FRAME_INVALID_SIZE');
  }
  const bytes = await readFile(outputPath);
  const dimensions = imageDimensions(bytes, '.jpg');
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error('VIDEO_DOCUMENT_FRAME_INVALID');
  }
  return { ...dimensions, byteSize: metadata.size };
}

function evidenceDirectory(libraryRoot: string, extractionId: string) {
  return path.join(libraryRoot, evidenceRelativeRoot, extractionId);
}

function mediaUrl(extractionId: string, fileName: string) {
  return `aiy-media://video-evidence/${encodeURIComponent(extractionId)}/${encodeURIComponent(fileName)}`;
}

function manifestDto(manifest: VideoKeyChangeManifest): VideoKeyChangeResultDto {
  return {
    extractionId: manifest.extractionId,
    documentId: manifest.documentId,
    sourceAssetId: manifest.sourceAssetId,
    algorithmVersion: manifest.algorithmVersion,
    durationMs: manifest.durationMs,
    sampleIntervalMs: manifest.sampleIntervalMs,
    scannedFrameCount: manifest.scannedFrameCount,
    candidates: manifest.candidates.map((candidate) => ({
      id: candidate.id,
      timestampMs: candidate.timestampMs,
      score: candidate.score,
      reason: candidate.reason,
      imageUrl: mediaUrl(manifest.extractionId, candidate.fileName),
      width: candidate.width,
      height: candidate.height,
    })),
    createdAt: manifest.createdAt,
  };
}

export function resolveVideoKeyChangeMediaPath(libraryRoot: string, identifier: string) {
  const match = /^([a-f0-9]{64})\/(frame-\d{3}\.jpg)$/.exec(identifier);
  if (!match) return null;
  const root = evidenceDirectory(libraryRoot, match[1]!);
  const candidate = path.resolve(root, match[2]!);
  if (!isPathInside(root, candidate)) return null;
  try {
    const resolvedRoot = realpathSync(root);
    const resolvedCandidate = realpathSync(candidate);
    return isPathInside(resolvedRoot, resolvedCandidate) && statSync(resolvedCandidate).isFile()
      ? resolvedCandidate
      : null;
  } catch {
    return null;
  }
}

export class VideoKeyChangeService {
  private readonly pending = new Map<string, PendingVideoKeyChangeExtraction>();
  private activeFfmpegOperations = 0;

  constructor(private readonly database: VideoKeyChangeDatabase) {}

  async get(documentId: string) {
    const source = this.captureSource(documentId);
    try {
      const manifest = await this.readManifest(source);
      return manifest ? manifestDto(manifest) : null;
    } catch {
      return null;
    }
  }

  async extract(input: VideoKeyChangeExtractInput, signal?: AbortSignal) {
    throwIfKeyChangeCancelled(signal);
    const source = this.captureSource(input.documentId);
    const cached = await this.readManifest(source).catch(() => null);
    throwIfKeyChangeCancelled(signal);
    if (cached) return manifestDto(cached);
    const existing = this.pending.get(source.extractionId);
    if (existing) return this.consumePending(existing, signal);
    if (this.activeFfmpegOperations >= maximumConcurrentFfmpegOperations) {
      throw new Error('VIDEO_KEY_CHANGES_BUSY');
    }

    this.activeFfmpegOperations += 1;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(keyChangeTerminationError('timeout')),
      keyChangeExtractionTimeoutMs,
    );
    timeout.unref();
    const pending: PendingVideoKeyChangeExtraction = {
      controller,
      promise: this.runExtraction(source, controller.signal),
      consumers: 0,
      completed: false,
    };
    pending.promise = pending.promise.finally(() => {
      clearTimeout(timeout);
      pending.completed = true;
      this.activeFfmpegOperations -= 1;
      this.pending.delete(source.extractionId);
    });
    this.pending.set(source.extractionId, pending);
    return this.consumePending(pending, signal);
  }

  async modelEvidence(documentId: string, maximum = 8, signal?: AbortSignal): Promise<VideoKeyChangeModelEvidence> {
    const evidence = await this.allModelEvidence(documentId, signal);
    return {
      extractionId: evidence.extractionId,
      sourceAssetId: evidence.sourceAssetId,
      sourceObjectHash: evidence.sourceObjectHash,
      candidates: selectVideoKeyChangeModelCandidates(evidence.candidates, maximum),
    };
  }

  async allModelEvidence(documentId: string, signal?: AbortSignal): Promise<VideoKeyChangeModelEvidence> {
    throwIfKeyChangeCancelled(signal);
    const source = this.captureSource(documentId);
    let manifest = await this.readManifest(source).catch(() => null);
    throwIfKeyChangeCancelled(signal);
    if (!manifest) {
      await this.extract({ documentId }, signal);
      manifest = await this.readManifest(source);
    }
    throwIfKeyChangeCancelled(signal);
    if (!manifest) throw new Error('VIDEO_KEY_CHANGES_CACHE_UNAVAILABLE');
    return {
      extractionId: manifest.extractionId,
      sourceAssetId: manifest.sourceAssetId,
      sourceObjectHash: manifest.sourceObjectHash,
      candidates: manifest.candidates.map((candidate) => {
        throwIfKeyChangeCancelled(signal);
        const filePath = resolveVideoKeyChangeMediaPath(
          source.libraryRoot,
          `${manifest.extractionId}/${candidate.fileName}`,
        );
        if (!filePath) throw new Error('VIDEO_KEY_CHANGES_CANDIDATE_UNAVAILABLE');
        return {
          id: candidate.id,
          timestampMs: candidate.timestampMs,
          score: candidate.score,
          reason: candidate.reason,
          width: candidate.width,
          height: candidate.height,
          filePath,
        };
      }),
    };
  }

  private async consumePending(pending: PendingVideoKeyChangeExtraction, signal?: AbortSignal) {
    throwIfKeyChangeCancelled(signal);
    pending.consumers += 1;
    return new Promise<VideoKeyChangeResultDto>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        pending.consumers -= 1;
        if (!pending.completed && pending.consumers === 0) pending.controller.abort();
        operation();
      };
      const cancel = () => finish(() => reject(keyChangeAbortError(signal)));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      pending.promise.then(
        (result) => finish(() => resolve(result)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  async captureFrame(
    input: VideoDocumentFrameCaptureInput,
    signal?: AbortSignal,
  ): Promise<VideoDocumentFrameCaptureResult> {
    throwIfFrameCaptureCancelled(signal);
    const source = this.captureSource(input.documentId);
    if (this.activeFfmpegOperations >= maximumConcurrentFfmpegOperations) {
      throw new Error('VIDEO_DOCUMENT_FRAME_CAPTURE_BUSY');
    }
    this.activeFfmpegOperations += 1;
    const timestampMs = Math.min(Math.max(0, input.timestampMs), Math.max(0, source.durationMs - 1));
    const parent = path.join(source.libraryRoot, evidenceRelativeRoot, 'manual');
    try {
      await mkdir(parent, { recursive: true });
      const stagingDirectory = await mkdtemp(path.join(parent, '.staging-'));
      const framePath = path.join(stagingDirectory, 'frame.jpg');
      try {
        const frame = await extractFrameAtTimestamp(source.sourcePath, framePath, timestampMs, signal);
        throwIfFrameCaptureCancelled(signal);
        const current = this.database.getVideoDocument(input.documentId);
        if (current.source.asset.id !== source.sourceAssetId) {
          throw new Error('VIDEO_DOCUMENT_SOURCE_CHANGED');
        }
        throwIfFrameCaptureCancelled(signal);
        const candidateId = `${source.extractionId.slice(0, 16)}-manual-${timestampMs}`;
        const assetId = await this.database.ensurePrivateVideoDocumentEvidenceImage({
          documentId: input.documentId,
          candidateId,
          sourcePath: framePath,
        });
        return {
          binding: {
            path: `assets/frame-${String(timestampMs).padStart(10, '0')}.jpg`,
            assetId,
            kind: 'IMAGE',
            timestampMs,
            endTimestampMs: null,
            posterAssetId: null,
          },
          media: {
            assetId,
            mediaUrl: assetMediaUrl(assetId),
            mimeType: 'image/jpeg',
            width: frame.width,
            height: frame.height,
            byteSize: frame.byteSize,
            durationMs: null,
          },
        };
      } finally {
        const stagingRoot = path.resolve(parent);
        const resolvedStaging = path.resolve(stagingDirectory);
        if (isPathInside(stagingRoot, resolvedStaging)) await rm(resolvedStaging, { recursive: true, force: true });
      }
    } finally {
      this.activeFfmpegOperations -= 1;
    }
  }

  private captureSource(documentId: string): CapturedVideoSource {
    const document = this.database.getVideoDocument(documentId);
    if (!document.source.available) throw new Error('VIDEO_KEY_CHANGES_SOURCE_UNAVAILABLE');
    const sourceAssetId = document.source.asset.id;
    const source = this.database.resolveAssetFile(sourceAssetId);
    if (!source || !source.mimeType.startsWith('video/')) throw new Error('VIDEO_KEY_CHANGES_SOURCE_UNAVAILABLE');
    const libraryRoot = this.database.libraryRoot;
    const sourceObjectHash = source.objectHash;
    const extractionId = createHash('sha256')
      .update(`${algorithmVersion}\0${documentId}\0${sourceAssetId}\0${sourceObjectHash}`)
      .digest('hex');
    const outputDirectory = evidenceDirectory(libraryRoot, extractionId);
    return {
      documentId,
      sourceAssetId,
      sourceObjectHash,
      sourcePath: source.absolutePath,
      libraryRoot,
      durationMs: document.source.asset.durationMs,
      extractionId,
      outputDirectory,
      manifestPath: path.join(outputDirectory, 'manifest.json'),
    };
  }

  private async readManifest(source: CapturedVideoSource) {
    try {
      const metadata = await stat(source.manifestPath);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumManifestBytes) return null;
      const raw: unknown = JSON.parse(await readFile(source.manifestPath, 'utf8'));
      const manifest = manifestSchema.parse(raw);
      if (
        manifest.extractionId !== source.extractionId ||
        manifest.documentId !== source.documentId ||
        manifest.sourceAssetId !== source.sourceAssetId ||
        manifest.sourceObjectHash !== source.sourceObjectHash ||
        manifest.durationMs !== source.durationMs
      ) {
        return null;
      }
      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async runExtraction(source: CapturedVideoSource, signal: AbortSignal) {
    const sampleIntervalMs = ffmpegSampleInterval(source.durationMs, maximumScanFrames);
    const scores = await scanVideo(source.sourcePath, sampleIntervalMs, signal);
    throwIfKeyChangeCancelled(signal);
    const samples = selectVideoKeyChangeSamples(scores, sampleIntervalMs, source.durationMs);
    const parent = path.join(source.libraryRoot, evidenceRelativeRoot);
    await mkdir(parent, { recursive: true });
    const stagingDirectory = await mkdtemp(path.join(parent, '.staging-'));
    try {
      const frames = await extractCandidateImages(
        source.sourcePath,
        stagingDirectory,
        samples,
        sampleIntervalMs,
        signal,
      );
      throwIfKeyChangeCancelled(signal);
      const manifest = manifestSchema.parse({
        extractionId: source.extractionId,
        documentId: source.documentId,
        sourceAssetId: source.sourceAssetId,
        sourceObjectHash: source.sourceObjectHash,
        algorithmVersion,
        durationMs: source.durationMs,
        sampleIntervalMs,
        scannedFrameCount: scores.length,
        candidates: samples.map((sample, index) => ({
          id: `${source.extractionId.slice(0, 16)}-${sample.sampleIndex}`,
          sampleIndex: sample.sampleIndex,
          timestampMs: sample.timestampMs,
          score: sample.score,
          reason: sample.reason,
          ...frames[index]!,
        })),
        createdAt: new Date().toISOString(),
      });
      await writeFile(path.join(stagingDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
        signal,
      });
      throwIfKeyChangeCancelled(signal);
      try {
        await rename(stagingDirectory, source.outputDirectory);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        const racedManifest = await this.readManifest(source);
        if (!racedManifest) throw new Error('VIDEO_KEY_CHANGES_CACHE_CONFLICT');
        return manifestDto(racedManifest);
      }
      return manifestDto(manifest);
    } finally {
      const stagingRoot = path.resolve(parent);
      const resolvedStaging = path.resolve(stagingDirectory);
      if (isPathInside(stagingRoot, resolvedStaging)) await rm(resolvedStaging, { recursive: true, force: true });
    }
  }
}
