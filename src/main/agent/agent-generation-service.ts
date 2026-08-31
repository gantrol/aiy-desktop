import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import type { ZodType } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { AgentCommandKind } from '@/main/database/generation/agent-command-repository';
import type { GenerationCoordinator } from '@/main/generation/coordinator';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { imageDimensions } from '@/main/media/image-dimensions';
import { validateDecodablePngAsync } from '@/main/media/png-validation';
import { MAX_IMAGE_DECODER_PIXELS } from '@/shared/image-decoder-protocol';
import {
  agentAssetImportResultSchema,
  agentDraftPrepareResultSchema,
  agentGenerationStartResultSchema,
  agentJobCancelResultSchema,
  agentJobResultSchema,
  type AgentAssetDescriptor,
  type AgentAssetImportRequest,
  type AgentAssetImportResult,
  type AgentDraftPrepareRequest,
  type AgentDraftPrepareResult,
  type AgentGenerationDraft,
  type AgentGenerationStartRequest,
  type AgentGenerationStartResult,
  type AgentJobCancelRequest,
  type AgentJobCancelResult,
  type AgentJobGetRequest,
  type AgentJobResult,
} from '@/shared/contracts/agent-cli';

const MAX_AGENT_REFERENCE_BYTES = 25 * 1024 * 1024;
const supportedExtension: ReadonlyMap<string, AgentAssetDescriptor['mimeType']> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
] as const);

function agentError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function throwIfAgentCancelled(signal: AbortSignal) {
  if (signal.aborted) throw agentError('AIY_AGENT_CANCELLED', 'Reference image import was cancelled');
}

function requestHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedAbsoluteFilePath(filePath: string) {
  if (filePath.includes('\0') || !path.isAbsolute(filePath) || /[*?]/u.test(filePath)) {
    throw agentError(
      'AIY_AGENT_INVALID_IMAGE_PATH',
      'Reference images require an explicit absolute file path without wildcards',
    );
  }
  return path.normalize(filePath);
}

function jpegContainerLooksComplete(bytes: Buffer) {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.byteLength - 2] === 0xff &&
    bytes[bytes.byteLength - 1] === 0xd9
  );
}

function webpContainerLooksComplete(bytes: Buffer) {
  return (
    bytes.byteLength >= 20 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.byteLength
  );
}

async function readValidatedReference(filePath: string, signal: AbortSignal) {
  throwIfAgentCancelled(signal);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = supportedExtension.get(extension);
  if (!mimeType) {
    throw agentError('AIY_AGENT_UNSUPPORTED_IMAGE', 'Reference images must be PNG, JPEG, or WebP files');
  }
  let source: Awaited<ReturnType<typeof lstat>>;
  try {
    source = await lstat(filePath);
  } catch {
    if (signal.aborted) throw agentError('AIY_AGENT_CANCELLED', 'Reference image import was cancelled');
    throw agentError('AIY_AGENT_IMAGE_UNAVAILABLE', 'Reference image is unavailable');
  }
  if (!source.isFile() || source.isSymbolicLink()) {
    throw agentError('AIY_AGENT_INVALID_IMAGE_PATH', 'Reference image must be one ordinary non-symlink file');
  }
  if (source.size < 1) throw agentError('AIY_AGENT_INVALID_IMAGE', 'Reference image is empty');
  if (source.size > MAX_AGENT_REFERENCE_BYTES) {
    throw agentError('AIY_AGENT_IMAGE_TOO_LARGE', 'Reference images must be 25 MB or smaller');
  }

  let bytes: Buffer;
  try {
    bytes = await readBoundedImageFile(filePath, signal);
  } catch (error) {
    if (signal.aborted) throw agentError('AIY_AGENT_CANCELLED', 'Reference image import was cancelled');
    throw agentError(
      'AIY_AGENT_IMAGE_UNAVAILABLE',
      error instanceof Error ? error.message : 'Reference image is unavailable',
    );
  }
  if (bytes.byteLength > MAX_AGENT_REFERENCE_BYTES) {
    throw agentError('AIY_AGENT_IMAGE_TOO_LARGE', 'Reference images must be 25 MB or smaller');
  }

  const dimensions = imageDimensions(bytes, extension);
  const decodable =
    mimeType === 'image/png'
      ? await validateDecodablePngAsync(bytes)
      : mimeType === 'image/jpeg'
        ? jpegContainerLooksComplete(bytes) && dimensions
        : webpContainerLooksComplete(bytes) && dimensions;
  if (!dimensions || !decodable) {
    throw agentError('AIY_AGENT_INVALID_IMAGE', 'Reference image signature or encoded data is invalid');
  }
  if (
    dimensions.width > 4_096 ||
    dimensions.height > 4_096 ||
    dimensions.width * dimensions.height > MAX_IMAGE_DECODER_PIXELS
  ) {
    throw agentError('AIY_AGENT_IMAGE_DIMENSIONS_UNSUPPORTED', 'Reference image dimensions exceed 4096 × 4096');
  }
  throwIfAgentCancelled(signal);
  return { bytes, mimeType, dimensions };
}

function assetDescriptor(database: LibraryDatabase, assetId: string): AgentAssetDescriptor {
  const file = database.resolveAssetFile(assetId);
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) {
    throw agentError('AIY_AGENT_ASSET_UNAVAILABLE', `Reference asset is unavailable: ${assetId}`);
  }
  if (file.byteSize < 1 || file.width < 1 || file.height < 1) {
    throw agentError('AIY_AGENT_ASSET_UNAVAILABLE', `Image asset metadata is invalid: ${assetId}`);
  }
  return {
    assetId: file.assetId,
    objectHash: file.objectHash,
    mimeType: file.mimeType as AgentAssetDescriptor['mimeType'],
    width: file.width,
    height: file.height,
    byteSize: file.byteSize,
  };
}

function referenceAssetDescriptor(database: LibraryDatabase, assetId: string) {
  const asset = assetDescriptor(database, assetId);
  if (
    asset.byteSize > MAX_AGENT_REFERENCE_BYTES ||
    asset.width > 4_096 ||
    asset.height > 4_096 ||
    asset.width * asset.height > MAX_IMAGE_DECODER_PIXELS
  ) {
    throw agentError('AIY_AGENT_ASSET_UNSUPPORTED', `Reference asset exceeds agent input limits: ${assetId}`);
  }
  return asset;
}

function effectivePrompt(request: AgentDraftPrepareRequest) {
  if (!request.references.length) return request.prompt;
  const heading =
    request.titleLocale === 'zh' ? '参考图用途（按附件顺序）：' : 'Reference image roles (attachment order):';
  const roles = request.references.map((reference, index) => `${index + 1}. ${reference.role}`).join('\n');
  const prompt = `${request.prompt}\n\n${heading}\n${roles}`;
  if (prompt.length > 30_000) {
    throw agentError('AIY_AGENT_PROMPT_TOO_LONG', 'Prompt and reference roles exceed the 30000 character limit');
  }
  return prompt;
}

function jobState(runs: AgentJobResult['runs']): AgentJobResult['state'] {
  if (!runs.length) return 'PREPARED';
  if (runs.every((run) => run.status === 'SUCCEEDED')) return 'SUCCEEDED';
  if (runs.some((run) => run.status === 'RUNNING')) return 'RUNNING';
  if (runs.some((run) => run.status === 'QUEUED')) return 'QUEUED';
  if (runs.some((run) => run.status === 'FAILED')) return 'FAILED';
  if (runs.some((run) => run.status === 'INTERRUPTED')) return 'INTERRUPTED';
  return 'CANCELLED';
}

function jobProgress(runs: AgentJobResult['runs']) {
  if (!runs.length) return null;
  const values = runs.map((run) => run.progress ?? (run.status === 'SUCCEEDED' ? 1 : 0));
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export class AgentGenerationService {
  constructor(
    private readonly database: LibraryDatabase,
    private readonly generation: GenerationCoordinator,
  ) {}

  private reusedCommand<T extends { reused: boolean }>(
    requestId: string,
    command: AgentCommandKind,
    inputHash: string,
    schema: ZodType<T>,
  ): T | null {
    const stored = this.database.getAgentCommand(requestId);
    if (!stored) return null;
    if (stored.command !== command || stored.inputHash !== inputHash) {
      throw agentError('AIY_AGENT_REQUEST_CONFLICT', 'The request id is already bound to different input');
    }
    try {
      return { ...schema.parse(stored.result), reused: true };
    } catch {
      throw agentError('AIY_AGENT_STORED_RESULT_INVALID', 'The stored agent command result is invalid');
    }
  }

  async importAsset(request: AgentAssetImportRequest, signal: AbortSignal): Promise<AgentAssetImportResult> {
    const filePath = normalizedAbsoluteFilePath(request.path);
    const inputHash = requestHash({ ...request, path: filePath });
    const reused = this.reusedCommand(request.requestId, 'ASSET_IMPORT', inputHash, agentAssetImportResultSchema);
    if (reused) return reused;

    const validated = await readValidatedReference(filePath, signal);
    const imported = await this.database.importReferenceBytes(path.basename(filePath), validated.bytes);
    const result = agentAssetImportResultSchema.parse({
      requestId: request.requestId,
      reused: false,
      asset: referenceAssetDescriptor(this.database, imported.id),
    });
    const raced = this.reusedCommand(request.requestId, 'ASSET_IMPORT', inputHash, agentAssetImportResultSchema);
    if (raced) return raced;
    this.database.recordAgentCommand(request.requestId, 'ASSET_IMPORT', inputHash, result);
    return result;
  }

  prepareDraft(request: AgentDraftPrepareRequest): AgentDraftPrepareResult {
    const inputHash = requestHash(request);
    const reused = this.reusedCommand(request.requestId, 'DRAFT_PREPARE', inputHash, agentDraftPrepareResultSchema);
    if (reused) return reused;

    const route = this.generation.imageGenerationRoutes.find((candidate) => candidate.key === request.modelKey);
    if (!route || route.state !== 'READY') {
      throw agentError('AIY_AGENT_ROUTE_UNAVAILABLE', `Image generation route is unavailable: ${request.modelKey}`);
    }
    if (route.qualityMode === 'SELECTABLE' && !route.supportedQualities.includes(request.quality)) {
      throw agentError('AIY_AGENT_QUALITY_UNAVAILABLE', `Selected quality is unavailable for ${route.name}`);
    }
    if (request.references.length && !route.capabilities.includes('REFERENCE_IMAGE')) {
      throw agentError('AIY_AGENT_REFERENCE_UNSUPPORTED', `${route.name} does not accept reference images`);
    }
    if (request.references.length > 1 && !route.capabilities.includes('MULTI_REFERENCE')) {
      throw agentError('AIY_AGENT_MULTI_REFERENCE_UNSUPPORTED', `${route.name} does not accept multiple references`);
    }
    if (route.maxReferenceImages !== null && request.references.length > route.maxReferenceImages) {
      throw agentError(
        'AIY_AGENT_REFERENCE_LIMIT',
        `${route.name} accepts at most ${route.maxReferenceImages} reference images`,
      );
    }

    const draft: AgentGenerationDraft = {
      title: request.title || (request.titleLocale === 'zh' ? 'Codex 贴图' : 'Codex sticker'),
      titleLocale: request.titleLocale,
      prompt: request.prompt,
      effectivePrompt: effectivePrompt(request),
      modelKey: request.modelKey,
      quality: request.quality,
      count: request.count,
      canvasPresetKey: request.canvasPresetKey,
      width: request.width,
      height: request.height,
      references: request.references.map((reference) => ({
        ...reference,
        asset: referenceAssetDescriptor(this.database, reference.assetId),
      })),
    };
    const draftId = ulid();
    const createdAt = new Date().toISOString();
    const result = agentDraftPrepareResultSchema.parse({
      requestId: request.requestId,
      draftId,
      reused: false,
      draft,
      createdAt,
    });
    const stored = this.database.createAgentGenerationDraftForCommand(
      request.requestId,
      inputHash,
      draftId,
      draft,
      createdAt,
      result,
    );
    return { ...result, createdAt: stored.createdAt };
  }

  startGeneration(request: AgentGenerationStartRequest): AgentGenerationStartResult {
    const inputHash = requestHash(request);
    const reused = this.reusedCommand(
      request.requestId,
      'GENERATION_START',
      inputHash,
      agentGenerationStartResultSchema,
    );
    if (reused) return reused;

    const job = this.database.getAgentGenerationJob(request.draftId);
    if (!job) throw agentError('AIY_AGENT_DRAFT_NOT_FOUND', 'Agent generation draft was not found');
    if (job.startedAt || job.runIds.length) {
      throw agentError('AIY_AGENT_JOB_ALREADY_STARTED', 'This draft already has a generation job');
    }
    const { draft } = job;
    let result: AgentGenerationStartResult | null = null;
    this.generation.startBatch(
      {
        input: {
          seriesId: null,
          creationDraftId: null,
          inspirationStashId: null,
          imageBreakdownId: null,
          baseVersionId: null,
          sourceImportId: null,
          sourceAssetId: null,
          title: draft.title,
          titleLocale: draft.titleLocale,
          manualPrompt: draft.prompt,
          prompt: draft.effectivePrompt,
          changeSummary: 'AIY Agent CLI',
          promptNodes: [{ kind: 'TEXT', text: draft.effectivePrompt }],
          referenceAssetIds: draft.references.map((reference) => reference.assetId),
          termPromptLocale: draft.titleLocale,
          termIds: [],
          wordPaletteReferences: [],
          canvasPresetKey: draft.canvasPresetKey,
          width: draft.width,
          height: draft.height,
          quality: draft.quality,
        },
        targets: [{ modelKey: draft.modelKey, count: draft.count, quality: draft.quality }],
      },
      (started) => {
        result = agentGenerationStartResultSchema.parse({
          requestId: request.requestId,
          jobId: job.id,
          draftId: job.id,
          reused: false,
          runIds: started.runIds,
          batchId: started.batchId,
          seriesId: started.seriesId,
          versionId: started.versionId,
        });
        this.database.markAgentGenerationJobStartedForCommand(
          request.requestId,
          inputHash,
          job.id,
          started.runIds,
          result,
        );
      },
    );
    if (!result) throw agentError('AIY_AGENT_START_FAILED', 'Agent generation job was not persisted before launch');
    return result;
  }

  getJob(request: AgentJobGetRequest): AgentJobResult {
    const job = this.database.getAgentGenerationJob(request.jobId);
    if (!job) throw agentError('AIY_AGENT_JOB_NOT_FOUND', 'Agent generation job was not found');
    const runs = job.runIds.map((runId): AgentJobResult['runs'][number] => {
      const state = this.database.getGenerationJob(runId);
      if (!state) throw agentError('AIY_AGENT_RUN_NOT_FOUND', `Generation run is unavailable: ${runId}`);
      const outputAssetId = this.database.getGenerationOutputAssetId(runId);
      const outputFile = outputAssetId ? this.database.resolveAssetFile(outputAssetId) : null;
      const output =
        outputAssetId && outputFile
          ? { ...assetDescriptor(this.database, outputAssetId), absolutePath: outputFile.absolutePath }
          : null;
      return {
        runId,
        status: state.status as AgentJobResult['runs'][number]['status'],
        phase: state.phase,
        progress: state.progress,
        errorCode: state.errorCode,
        errorMessage: state.errorMessage,
        output,
      };
    });
    return agentJobResultSchema.parse({
      jobId: job.id,
      draftId: job.id,
      state: jobState(runs),
      progress: jobProgress(runs),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      draft: job.draft,
      runs,
    });
  }

  cancelJob(request: AgentJobCancelRequest): AgentJobCancelResult {
    const inputHash = requestHash(request);
    const reused = this.reusedCommand(request.requestId, 'JOB_CANCEL', inputHash, agentJobCancelResultSchema);
    if (reused) return reused;
    const job = this.getJob({ protocolVersion: request.protocolVersion, jobId: request.jobId });
    const cancellationRequested = job.runs.some((run) => run.status === 'QUEUED' || run.status === 'RUNNING');
    for (const run of job.runs) this.generation.cancel(run.runId);
    const result = agentJobCancelResultSchema.parse({
      requestId: request.requestId,
      jobId: request.jobId,
      reused: false,
      cancellationRequested,
    });
    this.database.recordAgentCommand(request.requestId, 'JOB_CANCEL', inputHash, result);
    return result;
  }
}
