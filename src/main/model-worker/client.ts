import { utilityProcess } from 'electron';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync, unlinkSync, watch, type FSWatcher, type Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type {
  AntigravityCliStatusDto,
  AssistantActivityEventDto,
  AssistantRunDto,
  CodexHealth,
  CodexImageRefinementInput,
  CodexTitleInput,
  CodexTitleResult,
  CodexTextModelDto,
  CreatorAgentTurnDto,
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
  ImageTransformOutputDto,
  ImportPreview,
  ModelWorkerStatusDto,
  StyleExplorationBatchDto,
  StyleExplorationStartInput,
  VideoDocumentArticleGenerateInput,
  VideoDocumentArticleGenerateResult,
  VideoDocumentTranscriptTranslationResult,
  VideoDocumentTranscriptTranslationWorkerInput,
} from '@/shared/contracts';
import { CODEX_APP_SERVER_IMAGE_MODEL_KEY } from '@/shared/extension-ids';
import { videoDocumentArticleGenerateResultSchema } from '@/shared/contracts/video-document';
import { videoDocumentTranscriptTranslationResultSchema } from '@/shared/contracts/video-document-translation';
import type { AssistantService, AssistantTitleExecution } from '@/main/assistant/assistant-service';
import type { CodexChatJob, CodexService, CodexTitleExecutionOptions } from '@/main/assistant/codex-service';
import type { DeepSeekApiRuntimeConfiguration } from '@/main/extensions/deepseek-api/types';
import type { ExternalImageApiRuntimeConfiguration } from '@/main/extensions/external-image-api';
import type { OpenAiImageApiRuntimeConfiguration } from '@/main/extensions/openai-image-api/types';
import type { GenerationService } from '@/main/generation/service';
import { parseModelWorkerMethodParams } from '@/main/model-worker/method-params';
import {
  MODEL_WORKER_PROTOCOL_VERSION,
  createModelWorkerServerMessageDecoder,
  encodeWorkerMessage,
  parseModelWorkerDescriptor,
  parseModelWorkerStartupError,
  type ModelWorkerDescriptor,
  type ModelWorkerLaunchConfig,
  type ModelWorkerMethod,
  type ModelWorkerServerMessage,
  type ModelWorkerSnapshot,
} from '@/main/model-worker/protocol';

interface BackgroundGenerationClientOptions {
  databasePath: string;
  libraryRoot: string;
  workerBundlePath: string;
  internalModelsEnabled: boolean;
  cropImage(input: ImageCropInput): Promise<ImageTransformOutputDto>;
  idleExitMs?: number;
}

interface ResolvedBackgroundGenerationClientOptions extends BackgroundGenerationClientOptions {
  workerRuntimeFingerprint: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
  method: ModelWorkerMethod;
  cancellationRequested: boolean;
  removeAbortListener?(): void;
}

const CONNECT_TIMEOUT_MS = 1_500;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_CANCEL_GRACE_MS = 5_000;
const FORCE_SHUTDOWN_TIMEOUT_MS = 1_500;
const CODEX_ASSIST_TIMEOUT_MS = 300_000;
const VIDEO_DOCUMENT_ARTICLE_TIMEOUT_MS = 60 * 60_000;
const VIDEO_DOCUMENT_TRANSLATION_TIMEOUT_MS = 6 * 60 * 60_000;
const CODEX_TITLE_TIMEOUT_MS = 180_000;
const DEFAULT_IDLE_EXIT_MS = 10 * 60_000;
// Development builds briefly emitted these versions. They all support the
// authenticated idle-shutdown handshake and can be replaced without losing
// in-flight work.
const REPLACEABLE_DEVELOPMENT_PROTOCOL_VERSIONS = new Set([1, MODEL_WORKER_PROTOCOL_VERSION]);
const ROLLING_UPGRADE_SETTLE_MS = 1_000;
const WORKER_RETIRE_TIMEOUT_MS = 5_000;
const STARTUP_FALLBACK_MIN_MS = 250;
const STARTUP_FALLBACK_MAX_MS = 2_000;
const WORKER_STARTUP_TERMINATION_TIMEOUT_MS = 2_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

interface WorkerBundleFingerprintCacheEntry {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  fingerprint: string;
}

const workerBundleFingerprintCache = new Map<string, WorkerBundleFingerprintCacheEntry>();

function sameWorkerBundleFile(
  cached: Pick<WorkerBundleFingerprintCacheEntry, 'size' | 'mtimeMs' | 'ctimeMs' | 'dev' | 'ino'>,
  stats: Stats,
) {
  return (
    cached.size === stats.size &&
    cached.mtimeMs === stats.mtimeMs &&
    cached.ctimeMs === stats.ctimeMs &&
    cached.dev === stats.dev &&
    cached.ino === stats.ino
  );
}

async function workerBundleFingerprint(filePath: string) {
  const resolvedPath = path.resolve(filePath);
  let stats: Stats;
  try {
    stats = await stat(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'Background model service bundle is missing. Restart the development host once to load the new build configuration.',
      );
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error(
      'Background model service bundle is missing. Restart the development host once to load the new build configuration.',
    );
  }
  const cached = workerBundleFingerprintCache.get(resolvedPath);
  if (cached && sameWorkerBundleFile(cached, stats)) return cached.fingerprint;

  const fingerprint = createHash('sha256')
    .update(await readFile(resolvedPath))
    .digest('hex');
  const verifiedStats = await stat(resolvedPath);
  if (
    sameWorkerBundleFile(
      {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        dev: stats.dev,
        ino: stats.ino,
      },
      verifiedStats,
    )
  ) {
    workerBundleFingerprintCache.set(resolvedPath, {
      size: verifiedStats.size,
      mtimeMs: verifiedStats.mtimeMs,
      ctimeMs: verifiedStats.ctimeMs,
      dev: verifiedStats.dev,
      ino: verifiedStats.ino,
      fingerprint,
    });
  }
  return fingerprint;
}

function runtimeKey(libraryRoot: string) {
  const resolved = path.resolve(libraryRoot).replaceAll('\\', '/');
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function workerEndpoint(libraryRoot: string) {
  const key = runtimeKey(libraryRoot);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\aiy-model-${key}`
    : path.join(os.tmpdir(), `aiy-model-${key}.sock`);
}

function descriptorPath(libraryRoot: string) {
  return path.join(libraryRoot, 'temp', 'model-worker.json');
}

function readDescriptor(filePath: string): ModelWorkerDescriptor | null {
  try {
    return parseModelWorkerDescriptor(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForOwnedWorkerExit(filePath: string, workerId: string, pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptor = readDescriptor(filePath);
    if (!descriptor || descriptor.workerId !== workerId || descriptor.pid !== pid || !processIsRunning(pid))
      return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function readWorkerStartupError(filePath: string, workerId: string) {
  try {
    const value = parseModelWorkerStartupError(readFileSync(filePath, 'utf8'));
    if (!value || value.workerId !== workerId) return null;
    const error = new Error(value.message);
    if (value.code) Object.assign(error, { code: value.code });
    return error;
  } catch {
    return null;
  }
}

/**
 * Wakes the startup loop for atomic descriptor publication or worker errors.
 * The timed path is only a bounded fallback for hosts where fs.watch is
 * unavailable or drops an event.
 */
class WorkerStartupSignal {
  private watcher: FSWatcher | null = null;
  private revision = 0;
  private errorPending = false;
  private waiter: ((changed: boolean) => void) | null = null;

  constructor(descriptorFilePath: string, errorFilePath: string) {
    const directoryPath = path.dirname(descriptorFilePath);
    const descriptorName = path.basename(descriptorFilePath);
    const errorName = path.basename(errorFilePath);
    try {
      const watcher = watch(directoryPath, { persistent: false }, (_eventType, filename) => {
        const changedName = filename === null ? null : path.basename(filename.toString());
        if (changedName !== null && changedName !== descriptorName && changedName !== errorName) return;
        this.notify(changedName === null || changedName === errorName);
      });
      watcher.on('error', () => {
        if (this.watcher === watcher) this.watcher = null;
        watcher.close();
        this.notify(false);
      });
      this.watcher = watcher;
    } catch {
      // Exponential fallback checks below remain authoritative.
    }
  }

  get currentRevision() {
    return this.revision;
  }

  takeErrorSignal() {
    const pending = this.errorPending;
    this.errorPending = false;
    return pending;
  }

  notifyProcessStopped() {
    this.notify(true);
  }

  waitForChange(observedRevision: number, timeoutMs: number) {
    if (this.revision !== observedRevision) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (changed: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.waiter === finish) this.waiter = null;
        resolve(changed);
      };
      this.waiter = finish;
      timer = setTimeout(() => finish(false), timeoutMs);
      if (this.revision !== observedRevision) finish(true);
    });
  }

  close() {
    this.watcher?.close();
    this.watcher = null;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.(true);
  }

  private notify(errorChanged: boolean) {
    this.revision += 1;
    this.errorPending ||= errorChanged;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.(true);
  }
}

function endpointIsLive(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    const finish = (live: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(live);
    };
    const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function workerError(message: ModelWorkerServerMessage & { type: 'response' }) {
  if (!('error' in message)) return null;
  const error = new Error(message.error.message);
  if (message.error.code) Object.assign(error, { code: message.error.code });
  return error;
}

/**
 * Process-stable proxy for generation work. The model service runs as a Node
 * utility process owned by the Electron host.
 */
export class BackgroundGenerationClient extends EventEmitter implements GenerationService {
  private readonly clientId = randomUUID();
  private socket: net.Socket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rollingUpgradeTimer: ReturnType<typeof setTimeout> | null = null;
  private rollingUpgradePromise: Promise<void> | null = null;
  private reconnectAttempt = 0;
  private workerLaunchBlocked = false;
  private requestSequence = 0;
  private disposed = false;
  private connectionState: ModelWorkerStatusDto['state'] = 'RECONNECTING';
  private currentWorkerId: string | null = null;
  private connectedProtocolVersion: number | null = null;
  private connectedRuntimeFingerprint: string | null = null;
  private currentCodexHealth: CodexHealth = {
    state: 'checking',
    version: '',
    authenticated: false,
    message: 'Checking local Codex',
  };
  private currentCodexPendingCount = 0;
  private currentAntigravityCliStatus: AntigravityCliStatusDto = {
    state: 'checking',
    version: '',
    authenticated: false,
    message: 'Checking local Antigravity CLI',
    currentModel: null,
    models: [],
    quota: { warning: 'UNAVAILABLE', groups: [], checkedAt: null, message: 'Quota is unavailable' },
  };
  private currentImageGenerationRoutes: ImageGenerationRouteDto[] = [];
  private currentTasks: GenerationTaskDto[] = [];
  private cachedOpenAiImageApiConfiguration: OpenAiImageApiRuntimeConfiguration | null = null;
  private hasCachedOpenAiImageApiConfiguration = false;
  private cachedDeepSeekApiConfiguration: DeepSeekApiRuntimeConfiguration | null = null;
  private hasCachedDeepSeekApiConfiguration = false;
  private cachedExternalImageApiConfigurations: readonly ExternalImageApiRuntimeConfiguration[] = [];
  private hasCachedExternalImageApiConfigurations = false;
  private cachedConcurrencyConfiguration: ImageGenerationConcurrencyDto | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly codexPendingListeners = new Set<(activeCount: number) => void>();
  readonly codex: CodexService;
  readonly assistant: AssistantService;

  private constructor(private readonly options: ResolvedBackgroundGenerationClientOptions) {
    super();
    this.codex = new BackgroundCodexService(this);
    this.assistant = new BackgroundAssistantService(this);
  }

  static async create(options: BackgroundGenerationClientOptions) {
    const workerRuntimeFingerprint = await workerBundleFingerprint(options.workerBundlePath);
    const client = new BackgroundGenerationClient({ ...options, workerRuntimeFingerprint });
    void client.ensureConnected(true).catch((error) => {
      if (client.disposed) return;
      console.warn('[model-worker] initial connection deferred; retrying in the background', error);
      client.scheduleReconnect();
    });
    return client;
  }

  get hasPending() {
    return this.currentTasks.length > 0;
  }

  get imageGenerationRoutes() {
    return this.currentImageGenerationRoutes;
  }

  get antigravityCliStatus() {
    return this.currentAntigravityCliStatus;
  }

  get tasks() {
    return this.currentTasks;
  }

  get workerStatus(): ModelWorkerStatusDto {
    return {
      state: this.connectionState,
      workerId: this.currentWorkerId,
      generationTaskCount: this.currentTasks.length,
      codexTaskCount: this.currentCodexPendingCount,
    };
  }

  start(input: GenerationInput) {
    return this.call<{ runId: string; seriesId: string; versionId: string }>('generation.start', [input]);
  }

  startBatch(input: GenerationBatchInput) {
    return this.call<{ batchId: string | null; runIds: string[]; seriesId: string; versionId: string }>(
      'generation.start-batch',
      [input],
    );
  }

  startCodexImageRefinement(input: CodexImageRefinementInput) {
    return this.startImageEdit({
      ...input,
      modelKey: CODEX_APP_SERVER_IMAGE_MODEL_KEY,
      mode: 'SEMANTIC',
    });
  }

  startImageEdit(input: ImageEditStartInput) {
    return this.call<{ runId: string; seriesId: string; versionId: string }>('generation.start-image-edit', [input]);
  }

  startImageEditBatch(input: ImageEditBatchStartInput) {
    return this.call<{ batchId: string | null; runIds: string[]; seriesId: string; versionId: string }>(
      'generation.start-image-edit-batch',
      [input],
    );
  }

  startImageReframe(input: ImageReframeStartInput) {
    return this.call<{ runId: string; seriesId: string; versionId: string }>('generation.start-image-reframe', [input]);
  }

  generateVideoDocumentArticle(input: VideoDocumentArticleGenerateInput, signal?: AbortSignal) {
    return this.callWorker<unknown>(
      'video-document.article-generate',
      [input],
      VIDEO_DOCUMENT_ARTICLE_TIMEOUT_MS,
      signal,
    ).then((result): VideoDocumentArticleGenerateResult => videoDocumentArticleGenerateResultSchema.parse(result));
  }

  translateVideoDocumentTranscript(input: VideoDocumentTranscriptTranslationWorkerInput, signal?: AbortSignal) {
    return this.callWorker<unknown>(
      'video-document.transcript-translate',
      [input],
      VIDEO_DOCUMENT_TRANSLATION_TIMEOUT_MS,
      signal,
    ).then((result): VideoDocumentTranscriptTranslationResult =>
      videoDocumentTranscriptTranslationResultSchema.parse(result),
    );
  }

  stageDictionaryImport(fileName: string, filePath: string) {
    return this.callWorker<ImportPreview>('dictionary.stage-import', [fileName, filePath], 120_000);
  }

  commitDictionaryImport(batchId: string) {
    return this.callWorker<{ imported: number; skipped: number }>('dictionary.commit-import', [batchId], 120_000);
  }

  cropImage(input: ImageCropInput) {
    // The database change listener already schedules the detached file-view
    // projection refresh. A refresh failure must not turn a committed crop
    // into an apparent failure and invite a duplicate retry.
    return this.options.cropImage(input);
  }

  startStyleExploration(input: StyleExplorationStartInput) {
    return this.call<StyleExplorationBatchDto>('generation.start-style-exploration', [input]);
  }

  cancelStyleExploration(batchId: string) {
    return this.call<void>('generation.cancel-style-exploration', [batchId]);
  }

  retryStyleExplorationSlot(slotId: string) {
    return this.call<void>('generation.retry-style-exploration-slot', [slotId]);
  }

  startVersion(input: GenerationVersionInput) {
    return this.call<{ runId: string; seriesId: string; versionId: string }>('generation.start-version', [input]);
  }

  retry(runId: string) {
    return this.call<{ runId: string; seriesId: string; versionId: string }>('generation.retry', [runId]);
  }

  cancel(runId: string) {
    return this.call<void>('generation.cancel', [runId]);
  }

  /** Close an idle worker as part of a normal application quit and wait for
   * its authenticated descriptor to be released. This never interrupts work. */
  async shutdown() {
    const expectedWorkerId = this.currentWorkerId;
    const workerDescriptorPath = descriptorPath(this.options.libraryRoot);
    const descriptor = readDescriptor(workerDescriptorPath);
    let requestError: unknown = null;
    let shutdownRequested = false;
    if (
      (!this.socket || this.socket.destroyed) &&
      descriptor &&
      expectedWorkerId &&
      descriptor.workerId === expectedWorkerId
    ) {
      try {
        await this.ensureConnected(false);
      } catch (error) {
        requestError = error;
      }
    }
    if (!requestError && this.socket && !this.socket.destroyed) {
      try {
        await this.call<void>('worker.shutdown', [], FORCE_SHUTDOWN_TIMEOUT_MS, true);
        shutdownRequested = true;
      } catch (error) {
        requestError = error;
      }
    }

    if (
      descriptor &&
      expectedWorkerId &&
      descriptor.workerId === expectedWorkerId &&
      descriptor.endpoint === workerEndpoint(this.options.libraryRoot) &&
      descriptor.pid > 0 &&
      descriptor.pid !== process.pid
    ) {
      if (requestError) throw requestError;
      if (
        shutdownRequested &&
        (await waitForOwnedWorkerExit(workerDescriptorPath, descriptor.workerId, descriptor.pid, 5_000))
      ) {
        return;
      }
      try {
        process.kill(descriptor.pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      if (!(await waitForOwnedWorkerExit(workerDescriptorPath, descriptor.workerId, descriptor.pid, 2_000))) {
        throw new Error('Background model service did not stop during application quit');
      }
      return;
    }
    if (requestError) throw requestError;
  }

  /**
   * Explicit destructive escape hatch. Ask the authenticated worker to close
   * SQLite cleanly first; if it is unresponsive, terminate only the process
   * described by the current library's authenticated runtime descriptor.
   */
  async forceShutdown() {
    const expectedWorkerId = this.currentWorkerId;
    const workerDescriptorPath = descriptorPath(this.options.libraryRoot);
    const descriptorBeforeRequest = readDescriptor(workerDescriptorPath);
    let requestError: unknown = null;
    if (this.socket && !this.socket.destroyed) {
      try {
        await this.call<void>('worker.force-shutdown', [], FORCE_SHUTDOWN_TIMEOUT_MS);
      } catch (error) {
        requestError = error;
      }
    }

    const descriptor = descriptorBeforeRequest ?? readDescriptor(workerDescriptorPath);
    if (
      !descriptor ||
      !expectedWorkerId ||
      descriptor.workerId !== expectedWorkerId ||
      descriptor.endpoint !== workerEndpoint(this.options.libraryRoot) ||
      descriptor.pid <= 0 ||
      descriptor.pid === process.pid
    ) {
      if (requestError) throw requestError;
      return;
    }
    if (
      !requestError &&
      (await waitForOwnedWorkerExit(workerDescriptorPath, descriptor.workerId, descriptor.pid, 2_000))
    ) {
      return;
    }
    try {
      process.kill(descriptor.pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await waitForOwnedWorkerExit(workerDescriptorPath, descriptor.workerId, descriptor.pid, 2_000);
  }

  refreshExtensions() {
    return this.call<CodexHealth>('extensions.refresh', []);
  }

  refreshAntigravityCli() {
    return this.call<AntigravityCliStatusDto>('antigravity.refresh-status', []).then((status) => {
      this.currentAntigravityCliStatus = status;
      return status;
    });
  }

  configureOpenAiImageApi(configuration: OpenAiImageApiRuntimeConfiguration | null) {
    this.cachedOpenAiImageApiConfiguration = configuration;
    this.hasCachedOpenAiImageApiConfiguration = true;
    if (this.connectedProtocolVersion === null) return Promise.resolve();
    if (this.connectedProtocolVersion !== null && this.workerNeedsUpgrade()) {
      this.scheduleRollingUpgrade();
      return Promise.resolve();
    }
    return this.call<void>('extensions.configure-openai-image-api', [configuration]);
  }

  configureDeepSeekApi(configuration: DeepSeekApiRuntimeConfiguration | null) {
    this.cachedDeepSeekApiConfiguration = configuration;
    this.hasCachedDeepSeekApiConfiguration = true;
    if (this.connectedProtocolVersion === null) return Promise.resolve();
    if (this.connectedProtocolVersion !== null && this.workerNeedsUpgrade()) {
      this.scheduleRollingUpgrade();
      return Promise.resolve();
    }
    return this.call<void>('extensions.configure-deepseek-api', [configuration]);
  }

  configureExternalImageApis(configurations: readonly ExternalImageApiRuntimeConfiguration[]) {
    this.cachedExternalImageApiConfigurations = configurations;
    this.hasCachedExternalImageApiConfigurations = true;
    if (this.connectedProtocolVersion === null) return Promise.resolve();
    if (this.connectedProtocolVersion !== null && this.workerNeedsUpgrade()) {
      this.scheduleRollingUpgrade();
      return Promise.resolve();
    }
    return this.call<void>('extensions.configure-external-image-apis', [configurations]);
  }

  configureConcurrency(configuration: ImageGenerationConcurrencyDto) {
    this.cachedConcurrencyConfiguration = {
      ...configuration,
      limitsByModelKey: { ...configuration.limitsByModelKey },
    };
    if (this.connectedProtocolVersion === null) return Promise.resolve();
    if (this.workerNeedsUpgrade()) {
      this.scheduleRollingUpgrade();
      return Promise.resolve();
    }
    return this.call<void>('generation.configure-concurrency', [this.cachedConcurrencyConfiguration]);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.rollingUpgradeTimer) clearTimeout(this.rollingUpgradeTimer);
    this.rollingUpgradeTimer = null;
    const error = new Error('Background model service client closed');
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.removeAbortListener?.();
      if (this.socket && !this.socket.destroyed) {
        this.socket.write(encodeWorkerMessage({ type: 'cancel', id }));
      }
      request.reject(error);
    }
    this.pending.clear();
    this.codexPendingListeners.clear();
    this.socket?.destroy();
    this.socket = null;
    this.removeAllListeners();
  }

  codexHealth() {
    return this.currentCodexHealth;
  }

  codexPendingCount() {
    return this.currentCodexPendingCount;
  }

  onCodexPendingChanged(listener: (activeCount: number) => void) {
    this.codexPendingListeners.add(listener);
    return () => {
      this.codexPendingListeners.delete(listener);
    };
  }

  callWorker<T>(
    method: ModelWorkerMethod,
    params: unknown[],
    timeoutMs = REQUEST_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.call(method, params, timeoutMs, false, signal);
  }

  private async call<T>(
    method: ModelWorkerMethod,
    params: unknown[],
    timeoutMs = REQUEST_TIMEOUT_MS,
    bypassRollingUpgrade = false,
    signal?: AbortSignal,
  ): Promise<T> {
    const validatedParams = parseModelWorkerMethodParams(method, params);
    if (signal?.aborted) {
      throw Object.assign(new Error('Background model service request was cancelled'), { code: 'CANCELLED' as const });
    }
    if (this.disposed) throw new Error('Background model service is unavailable');
    if (!bypassRollingUpgrade && this.rollingUpgradePromise) await this.rollingUpgradePromise;
    await this.ensureConnected(true);
    if (signal?.aborted) {
      throw Object.assign(new Error('Background model service request was cancelled'), { code: 'CANCELLED' as const });
    }
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error('Background model service is disconnected');
    const id = `${this.clientId}:${++this.requestSequence}`;
    return new Promise<T>((resolve, reject) => {
      const requestCancellation = () => {
        const request = this.pending.get(id);
        if (!request || request.cancellationRequested) return;
        request.cancellationRequested = true;
        clearTimeout(request.timer);
        if (!socket.destroyed) socket.write(encodeWorkerMessage({ type: 'cancel', id }));
        request.timer = setTimeout(() => {
          if (this.pending.get(id) !== request) return;
          this.pending.delete(id);
          request.removeAbortListener?.();
          const error = new Error(`Background model service request state is unknown after timeout: ${method}`);
          Object.assign(error, { code: 'REQUEST_STATE_UNKNOWN', operationId: id });
          request.reject(error);
        }, REQUEST_CANCEL_GRACE_MS);
      };
      const timer = setTimeout(requestCancellation, timeoutMs);
      const request: PendingRequest = {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        method,
        cancellationRequested: false,
      };
      if (signal) {
        signal.addEventListener('abort', requestCancellation, { once: true });
        request.removeAbortListener = () => signal.removeEventListener('abort', requestCancellation);
      }
      this.pending.set(id, request);
      socket.write(encodeWorkerMessage({ type: 'request', id, method, params: validatedParams }), (error) => {
        if (!error) return;
        const request = this.pending.get(id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(id);
        request.removeAbortListener?.();
        request.reject(error);
      });
      if (signal?.aborted) requestCancellation();
    });
  }

  private ensureConnected(allowLaunch: boolean): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOrLaunch(allowLaunch).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connectOrLaunch(allowLaunch: boolean) {
    const filePath = descriptorPath(this.options.libraryRoot);
    const existing = readDescriptor(filePath);
    if (existing) {
      if (
        existing.protocolVersion !== MODEL_WORKER_PROTOCOL_VERSION ||
        existing.runtimeFingerprint !== this.options.workerRuntimeFingerprint
      ) {
        const supportsRollingUpgrade =
          existing.protocolVersion === MODEL_WORKER_PROTOCOL_VERSION ||
          REPLACEABLE_DEVELOPMENT_PROTOCOL_VERSIONS.has(existing.protocolVersion);
        if (supportsRollingUpgrade) {
          try {
            await this.connect(existing);
            if (this.currentTasks.length > 0 || this.currentCodexPendingCount > 0) {
              this.scheduleRollingUpgrade();
              return;
            }
            await this.retireConnectedWorker(existing, filePath);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/authentication failed|protocol mismatch/i.test(message)) throw error;
            if (await endpointIsLive(existing.endpoint)) throw error;
          }
        } else if (await endpointIsLive(existing.endpoint)) {
          throw new Error(
            `The running background model service uses incompatible protocol v${existing.protocolVersion}; host requires v${MODEL_WORKER_PROTOCOL_VERSION}`,
          );
        }
        const stale = readDescriptor(filePath);
        if (stale?.workerId === existing.workerId) {
          try {
            unlinkSync(filePath);
          } catch {
            /* a new worker may already own it */
          }
        }
      } else {
        try {
          await this.connectAndRestoreRuntimeConfigurations(existing);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/authentication failed|protocol mismatch/i.test(message)) throw error;
          // A stale descriptor is expected after a worker or machine crash.
        }
      }
    }
    if (!allowLaunch) throw new Error('Background model service is unavailable');
    if (this.workerLaunchBlocked) {
      throw new Error('Background model service relaunch is disabled because the previous worker did not stop');
    }

    const errorPath = path.join(path.dirname(filePath), 'model-worker.error.json');
    try {
      unlinkSync(errorPath);
    } catch {
      /* no stale error */
    }
    const startupSignal = new WorkerStartupSignal(filePath, errorPath);
    let launched: ReturnType<BackgroundGenerationClient['launchWorker']>;
    try {
      launched = this.launchWorker(filePath, errorPath);
    } catch (error) {
      startupSignal.close();
      throw error;
    }
    const startedAt = Date.now();
    let lastError: unknown = null;
    let fallbackDelayMs = STARTUP_FALLBACK_MIN_MS;
    let childExited = false;
    let connectedToLaunchedWorker = false;
    let waitingForSingletonWinner = false;
    let resolveChildExit!: () => void;
    const childExit = new Promise<void>((resolve) => {
      resolveChildExit = resolve;
    });
    const onChildError = (_type: 'FatalError', location: string, report: string) => {
      lastError = new Error(`Background model service failed at ${location}`, {
        cause: report,
      });
      startupSignal.notifyProcessStopped();
    };
    const onChildExit = (code: number) => {
      childExited = true;
      resolveChildExit();
      if (!lastError) {
        lastError = new Error(`Background model service exited during startup with code ${code}`);
      }
      startupSignal.notifyProcessStopped();
    };
    launched.child.once('error', onChildError);
    launched.child.once('exit', onChildExit);
    try {
      while (!this.disposed && Date.now() - startedAt < START_TIMEOUT_MS) {
        const observedRevision = startupSignal.currentRevision;
        const candidate = readDescriptor(filePath);
        if (
          candidate?.protocolVersion === MODEL_WORKER_PROTOCOL_VERSION &&
          candidate.runtimeFingerprint === this.options.workerRuntimeFingerprint
        ) {
          try {
            await this.connectAndRestoreRuntimeConfigurations(candidate);
            connectedToLaunchedWorker = candidate.workerId === launched.workerId;
            return;
          } catch (error) {
            lastError = error;
          }
        }

        if (startupSignal.takeErrorSignal()) {
          const startupError = readWorkerStartupError(launched.errorPath, launched.workerId);
          if (startupError) {
            lastError = startupError;
            // Another client can win the singleton endpoint before it has written
            // its descriptor. Wait for that descriptor instead of failing early.
            if ((startupError as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw startupError;
            waitingForSingletonWinner = true;
          }
        }
        if (childExited && !waitingForSingletonWinner) {
          throw lastError instanceof Error
            ? lastError
            : new Error('Background model service stopped before publishing its descriptor');
        }

        const remainingMs = START_TIMEOUT_MS - (Date.now() - startedAt);
        if (remainingMs <= 0) break;
        const changed = await startupSignal.waitForChange(observedRevision, Math.min(fallbackDelayMs, remainingMs));
        fallbackDelayMs = changed ? STARTUP_FALLBACK_MIN_MS : Math.min(STARTUP_FALLBACK_MAX_MS, fallbackDelayMs * 2);
      }
      const finalStartupError = readWorkerStartupError(launched.errorPath, launched.workerId);
      if (finalStartupError) lastError = finalStartupError;
    } finally {
      startupSignal.close();
      if (!connectedToLaunchedWorker && !childExited) {
        launched.child.kill();
        await Promise.race([
          childExit,
          new Promise<void>((resolve) => setTimeout(resolve, WORKER_STARTUP_TERMINATION_TIMEOUT_MS)),
        ]);
        if (!childExited && launched.child.pid !== undefined) {
          this.workerLaunchBlocked = true;
          console.error('[model-worker] failed startup worker did not stop; blocking further launches', {
            pid: launched.child.pid,
            workerId: launched.workerId,
          });
        }
      }
      launched.child.off('error', onChildError);
      launched.child.off('exit', onChildExit);
    }
    throw lastError instanceof Error ? lastError : new Error('Background model service did not start in time');
  }

  private launchWorker(filePath: string, errorPath: string) {
    const config: ModelWorkerLaunchConfig = {
      protocolVersion: MODEL_WORKER_PROTOCOL_VERSION,
      runtimeFingerprint: this.options.workerRuntimeFingerprint,
      workerId: randomUUID(),
      token: randomBytes(32).toString('hex'),
      endpoint: workerEndpoint(this.options.libraryRoot),
      descriptorPath: filePath,
      errorPath,
      databasePath: this.options.databasePath,
      libraryRoot: this.options.libraryRoot,
      imageTransformWorkerPath: path.join(path.dirname(this.options.workerBundlePath), 'image-transform-worker.js'),
      internalModelsEnabled: this.options.internalModelsEnabled,
      idleExitMs: this.options.idleExitMs ?? DEFAULT_IDLE_EXIT_MS,
    };
    const workerEnvironment = { ...process.env };
    delete workerEnvironment.ELECTRON_RUN_AS_NODE;
    delete workerEnvironment.DEEPSEEK_API_KEY;
    const child = utilityProcess.fork(this.options.workerBundlePath, [], {
      cwd: this.options.libraryRoot,
      env: {
        ...workerEnvironment,
        AIY_MODEL_WORKER_CONFIG: JSON.stringify(config),
      },
      stdio: 'ignore',
      serviceName: 'AIY Model Worker',
    });
    child.once('error', () => {
      // The startup observer reports fatal utility-process failures.
    });
    return { workerId: config.workerId, errorPath, child };
  }

  private async retireConnectedWorker(descriptor: ModelWorkerDescriptor, filePath: string) {
    if (this.currentTasks.length > 0 || this.currentCodexPendingCount > 0 || this.pending.size > 0) {
      throw new Error('Background model service became busy during protocol upgrade');
    }
    if (this.rollingUpgradeTimer) clearTimeout(this.rollingUpgradeTimer);
    this.rollingUpgradeTimer = null;
    await this.call<void>('worker.shutdown-when-idle', [], REQUEST_TIMEOUT_MS, true);
    if (this.rollingUpgradeTimer) clearTimeout(this.rollingUpgradeTimer);
    this.rollingUpgradeTimer = null;
    this.disconnectForWorkerReplacement();
    await this.waitForWorkerExit(descriptor);
    const owned = readDescriptor(filePath);
    if (owned?.workerId === descriptor.workerId) {
      try {
        unlinkSync(filePath);
      } catch {
        /* the retiring worker may remove it first */
      }
    }
  }

  private disconnectForWorkerReplacement() {
    const socket = this.socket;
    this.socket = null;
    this.connectedProtocolVersion = null;
    this.connectedRuntimeFingerprint = null;
    this.connectionState = 'RECONNECTING';
    this.emitWorkerStatus();
    socket?.destroy();
  }

  private async waitForWorkerExit(descriptor: ModelWorkerDescriptor) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < WORKER_RETIRE_TIMEOUT_MS) {
      if (!(await endpointIsLive(descriptor.endpoint))) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // The worker was authenticated and observed idle before retirement. Only
    // terminate the still-owned descriptor; never act on a replacement PID.
    const current = readDescriptor(descriptorPath(this.options.libraryRoot));
    if (current?.workerId !== descriptor.workerId || current.pid !== descriptor.pid) {
      throw new Error('Background model service changed during protocol upgrade');
    }
    try {
      process.kill(descriptor.pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    const forcedAt = Date.now();
    while (Date.now() - forcedAt < CONNECT_TIMEOUT_MS) {
      if (!(await endpointIsLive(descriptor.endpoint))) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Background model service did not stop for protocol upgrade');
  }

  private scheduleRollingUpgrade() {
    if (
      this.disposed ||
      this.connectedProtocolVersion === null ||
      !this.workerNeedsUpgrade() ||
      this.rollingUpgradeTimer ||
      this.rollingUpgradePromise ||
      this.currentTasks.length > 0 ||
      this.currentCodexPendingCount > 0 ||
      this.pending.size > 0
    )
      return;
    this.rollingUpgradeTimer = setTimeout(() => {
      this.rollingUpgradeTimer = null;
      if (
        this.disposed ||
        this.connectedProtocolVersion === null ||
        !this.workerNeedsUpgrade() ||
        this.currentTasks.length > 0 ||
        this.currentCodexPendingCount > 0 ||
        this.pending.size > 0
      )
        return;
      const upgrade = this.performRollingUpgrade();
      this.rollingUpgradePromise = upgrade;
      void upgrade
        .catch((error) => {
          console.error('[model-worker] rolling protocol upgrade failed', error);
          this.scheduleReconnect();
        })
        .finally(() => {
          if (this.rollingUpgradePromise === upgrade) this.rollingUpgradePromise = null;
          this.scheduleRollingUpgrade();
        });
    }, ROLLING_UPGRADE_SETTLE_MS);
  }

  private workerNeedsUpgrade() {
    return (
      this.connectedProtocolVersion !== MODEL_WORKER_PROTOCOL_VERSION ||
      this.connectedRuntimeFingerprint !== this.options.workerRuntimeFingerprint
    );
  }

  private async performRollingUpgrade() {
    const filePath = descriptorPath(this.options.libraryRoot);
    const descriptor = readDescriptor(filePath);
    if (!descriptor || descriptor.workerId !== this.currentWorkerId) {
      throw new Error('Background model service descriptor changed during protocol upgrade');
    }
    if (
      descriptor.protocolVersion === MODEL_WORKER_PROTOCOL_VERSION &&
      descriptor.runtimeFingerprint === this.options.workerRuntimeFingerprint
    )
      return;
    await this.retireConnectedWorker(descriptor, filePath);
    if (this.disposed) return;
    await this.ensureConnected(true);
  }

  private async connectAndRestoreRuntimeConfigurations(descriptor: ModelWorkerDescriptor) {
    await this.connect(descriptor);
    try {
      await this.restoreRuntimeConfigurations();
    } catch (error) {
      const socket = this.socket;
      if (socket) {
        this.handleDisconnect(socket);
        socket.destroy();
      }
      throw error;
    }
  }

  private async restoreRuntimeConfigurations() {
    if (this.hasCachedOpenAiImageApiConfiguration) {
      await this.call<void>(
        'extensions.configure-openai-image-api',
        [this.cachedOpenAiImageApiConfiguration],
        REQUEST_TIMEOUT_MS,
        true,
      );
    }
    if (this.hasCachedDeepSeekApiConfiguration) {
      await this.call<void>(
        'extensions.configure-deepseek-api',
        [this.cachedDeepSeekApiConfiguration],
        REQUEST_TIMEOUT_MS,
        true,
      );
    }
    if (this.hasCachedExternalImageApiConfigurations) {
      await this.call<void>(
        'extensions.configure-external-image-apis',
        [this.cachedExternalImageApiConfigurations],
        REQUEST_TIMEOUT_MS,
        true,
      );
    }
    if (this.cachedConcurrencyConfiguration) {
      await this.call<void>(
        'generation.configure-concurrency',
        [this.cachedConcurrencyConfiguration],
        REQUEST_TIMEOUT_MS,
        true,
      );
    }
  }

  private connect(descriptor: ModelWorkerDescriptor): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(descriptor.endpoint);
      let ready = false;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error('Background model service connection timed out'));
      }, HANDSHAKE_TIMEOUT_MS);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        reject(error);
      };
      const decode = createModelWorkerServerMessageDecoder((message) => {
        if (!ready) {
          if (message.type === 'protocol-error') {
            fail(new Error(message.message));
            return;
          }
          if (message.type !== 'ready') {
            fail(new Error('Background model service returned an invalid handshake'));
            return;
          }
          if (message.snapshot.protocolVersion !== descriptor.protocolVersion) {
            fail(new Error('Background model service protocol mismatch'));
            return;
          }
          if (message.snapshot.runtimeFingerprint !== descriptor.runtimeFingerprint) {
            fail(new Error('Background model service runtime mismatch'));
            return;
          }
          ready = true;
          settled = true;
          clearTimeout(timeout);
          this.socket?.destroy();
          this.socket = socket;
          this.connectedProtocolVersion = descriptor.protocolVersion;
          this.connectedRuntimeFingerprint = descriptor.runtimeFingerprint;
          this.reconnectAttempt = 0;
          this.workerLaunchBlocked = false;
          this.applySnapshot(message.snapshot, true);
          resolve();
          return;
        }
        this.handleMessage(message);
      });
      socket.on('connect', () => {
        socket.write(
          encodeWorkerMessage({
            type: 'hello',
            protocolVersion: descriptor.protocolVersion,
            token: descriptor.token,
            clientId: this.clientId,
          }),
        );
      });
      socket.on('data', (chunk) => {
        try {
          decode(chunk);
        } catch (error) {
          if (ready) socket.destroy();
          else fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.on('error', (error) => {
        if (!ready) fail(error);
      });
      socket.on('close', () => {
        if (!ready) {
          fail(new Error('Background model service closed during handshake'));
          return;
        }
        this.handleDisconnect(socket);
      });
    });
  }

  private handleMessage(message: ModelWorkerServerMessage) {
    if (message.type === 'generation-changed') {
      this.currentTasks = message.event.tasks;
      this.emit('changed', message.event);
      this.emitWorkerStatus();
      this.scheduleRollingUpgrade();
      return;
    }
    if (message.type === 'assistant-progress') {
      this.emit('assistant-progress', message.event);
      return;
    }
    if (message.type === 'snapshot') {
      this.applySnapshot(message.snapshot, true);
      return;
    }
    if (message.type !== 'response') return;
    const request = this.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(message.id);
    request.removeAbortListener?.();
    const error = workerError(message);
    if (error) request.reject(error);
    else request.resolve('result' in message ? message.result : null);
    this.scheduleRollingUpgrade();
  }

  private applySnapshot(snapshot: ModelWorkerSnapshot, notify: boolean) {
    const previousCodexPendingCount = this.currentCodexPendingCount;
    this.connectionState = 'CONNECTED';
    this.currentWorkerId = snapshot.workerId;
    this.currentCodexHealth = snapshot.codexHealth;
    this.currentCodexPendingCount = snapshot.codexPendingCount;
    if (snapshot.antigravityCliStatus) this.currentAntigravityCliStatus = snapshot.antigravityCliStatus;
    this.currentImageGenerationRoutes = snapshot.imageGenerationRoutes;
    this.currentTasks = snapshot.generationTasks;
    if (previousCodexPendingCount !== this.currentCodexPendingCount) {
      for (const listener of this.codexPendingListeners) listener(this.currentCodexPendingCount);
    }
    if (notify) {
      const event: GenerationChangedEvent = { runId: '', tasks: this.currentTasks, terminal: false };
      this.emit('changed', event);
    }
    this.emitWorkerStatus();
    this.scheduleRollingUpgrade();
  }

  private handleDisconnect(socket: net.Socket) {
    if (this.disposed || this.socket !== socket) return;
    this.socket = null;
    this.connectedProtocolVersion = null;
    this.connectedRuntimeFingerprint = null;
    this.connectionState = 'RECONNECTING';
    this.emitWorkerStatus();
    const error = new Error('Background model service disconnected');
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.removeAbortListener?.();
      request.reject(error);
    }
    this.pending.clear();
    if (this.disposed || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(this.reconnectAttempt++, 6));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected(true).catch(() => this.scheduleReconnect());
    }, delay);
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer || this.socket) return;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(this.reconnectAttempt++, 6));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected(true).catch(() => this.scheduleReconnect());
    }, delay);
  }

  private emitWorkerStatus() {
    this.emit('worker-status-changed', this.workerStatus);
  }
}

class BackgroundCodexService implements CodexService {
  constructor(private readonly owner: BackgroundGenerationClient) {}

  get cachedHealth() {
    return this.owner.codexHealth();
  }

  get hasPending() {
    return this.pendingCount > 0;
  }

  get pendingCount() {
    return this.owner.codexPendingCount();
  }

  onPendingChanged(listener: (activeCount: number) => void) {
    return this.owner.onCodexPendingChanged(listener);
  }

  refreshHealth(signal?: AbortSignal) {
    return this.owner.callWorker<CodexHealth>('codex.refresh-health', [], REQUEST_TIMEOUT_MS, signal);
  }

  listModels(signal?: AbortSignal) {
    return this.owner.callWorker<CodexTextModelDto[]>('codex.list-models', [], REQUEST_TIMEOUT_MS, signal);
  }

  chat(job: CodexChatJob, signal?: AbortSignal) {
    return this.owner.callWorker<CreatorAgentTurnDto>('codex.chat', [job], CODEX_ASSIST_TIMEOUT_MS, signal);
  }

  suggestTitles(input: CodexTitleInput, options?: CodexTitleExecutionOptions, signal?: AbortSignal) {
    return this.owner.callWorker<CodexTitleResult>(
      'codex.suggest-titles',
      [input, options],
      CODEX_TITLE_TIMEOUT_MS,
      signal,
    );
  }

  cancelAll() {
    return this.owner.callWorker<void>('codex.cancel-all', []);
  }
}

class BackgroundAssistantService implements AssistantService {
  constructor(private readonly owner: BackgroundGenerationClient) {}

  run(runId: string) {
    return this.owner.callWorker<AssistantRunDto>('assistant.run', [runId], CODEX_ASSIST_TIMEOUT_MS);
  }

  suggestTitles(input: CodexTitleInput, execution: AssistantTitleExecution) {
    return this.owner.callWorker<CodexTitleResult>(
      'assistant.suggest-titles',
      [input, execution],
      CODEX_TITLE_TIMEOUT_MS,
    );
  }

  onProgress(listener: (event: AssistantActivityEventDto) => void) {
    this.owner.on('assistant-progress', listener);
    return () => this.owner.off('assistant-progress', listener);
  }
}
