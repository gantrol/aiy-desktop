import type {
  CodexImageRefinementInput,
  GenerationBatchInput,
  GenerationChangedEvent,
  GenerationInput,
  ImageGenerationConcurrencyDto,
  ImageEditBatchStartInput,
  ImageEditStartInput,
  ImageReframeStartInput,
  ImageGenerationRouteDto,
  GenerationTaskDto,
  GenerationVersionInput,
  ImageCropInput,
  ModelWorkerStatusDto,
  ImageTransformOutputDto,
  ImportPreview,
  StyleExplorationBatchDto,
  StyleExplorationStartInput,
} from '@/shared/contracts';
import type { OpenAiImageApiRuntimeConfiguration } from '@/main/extensions/openai-image-api/types';
import type { DeepSeekApiRuntimeConfiguration } from '@/main/extensions/deepseek-api/types';
import type { ExternalImageApiRuntimeConfiguration } from '@/main/extensions/external-image-api';

type MaybePromise<T> = T | Promise<T>;

/**
 * Stable boundary between Electron IPC and the process that owns model work.
 * The in-process coordinator and the detached worker client both implement it.
 */
export interface GenerationService {
  readonly hasPending: boolean;
  readonly imageGenerationRoutes: ImageGenerationRouteDto[];
  readonly tasks: GenerationTaskDto[];
  readonly workerStatus: ModelWorkerStatusDto;

  start(input: GenerationInput): MaybePromise<{ runId: string; seriesId: string; versionId: string }>;
  startBatch(
    input: GenerationBatchInput,
  ): MaybePromise<{ batchId: string | null; runIds: string[]; seriesId: string; versionId: string }>;
  startImageEdit(input: ImageEditStartInput): MaybePromise<{ runId: string; seriesId: string; versionId: string }>;
  startImageEditBatch(
    input: ImageEditBatchStartInput,
  ): MaybePromise<{ batchId: string | null; runIds: string[]; seriesId: string; versionId: string }>;
  startImageReframe(
    input: ImageReframeStartInput,
  ): MaybePromise<{ runId: string; seriesId: string; versionId: string }>;
  startCodexImageRefinement(
    input: CodexImageRefinementInput,
  ): MaybePromise<{ runId: string; seriesId: string; versionId: string }>;
  startStyleExploration(input: StyleExplorationStartInput): MaybePromise<StyleExplorationBatchDto>;
  cancelStyleExploration(batchId: string): MaybePromise<void>;
  retryStyleExplorationSlot(slotId: string): MaybePromise<void>;
  startVersion(input: GenerationVersionInput): MaybePromise<{ runId: string; seriesId: string; versionId: string }>;
  retry(runId: string): MaybePromise<{ runId: string; seriesId: string; versionId: string }>;
  cancel(runId: string): MaybePromise<void>;
  /** Re-read extension activation and connection state in the detached worker. */
  refreshExtensions?(): MaybePromise<unknown>;
  /** Replace the worker's in-memory OpenAI credential; never persisted by the worker. */
  configureOpenAiImageApi?(configuration: OpenAiImageApiRuntimeConfiguration | null): MaybePromise<unknown>;
  /** Replace the worker's in-memory DeepSeek credential; never read from ambient environment variables. */
  configureDeepSeekApi?(configuration: DeepSeekApiRuntimeConfiguration | null): MaybePromise<unknown>;
  /** Replace external image-provider credentials held only in worker memory. */
  configureExternalImageApis?(configurations: readonly ExternalImageApiRuntimeConfiguration[]): MaybePromise<unknown>;
  /** Replace the worker's app-level per-model admission limits. */
  configureConcurrency?(configuration: ImageGenerationConcurrencyDto): MaybePromise<unknown>;
  /** Run payload-proportional dictionary parsing/staging outside Electron's UI host. */
  stageDictionaryImport?(fileName: string, filePath: string): MaybePromise<ImportPreview>;
  /** Commit a staged dictionary batch outside Electron's UI host. */
  commitDictionaryImport?(batchId: string): MaybePromise<{ imported: number; skipped: number }>;
  /** Decode, crop, encode, and persist a full-resolution image outside the UI host. */
  cropImage?(input: ImageCropInput): MaybePromise<ImageTransformOutputDto>;

  on(event: 'changed', listener: (event: GenerationChangedEvent) => void): this;
  on(event: 'worker-status-changed', listener: (status: ModelWorkerStatusDto) => void): this;
  dispose(): void;
}
