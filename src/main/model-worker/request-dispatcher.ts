import { decodeDeepSeekTitleResult, DeepSeekAssistantAdapter } from '@/main/assistant-models/deepseek';
import { AntigravityAssistantAdapter } from '@/main/assistant-models/antigravity';
import { GoogleGeminiAssistantAdapter } from '@/main/assistant-models/google-gemini';
import { ImageBreakdownModelAdapter } from '@/main/assistant-models/image-breakdown';
import { DEEPSEEK_DEFAULT_MODEL_ID, DEEPSEEK_PROVIDER_KEY } from '@/main/assistant-models/deepseek-provider';
import { CodexAdapter } from '@/main/assistant/codex';
import type { AgentGenerationService } from '@/main/agent/agent-generation-service';
import { LibraryDatabase } from '@/main/database';
import { readDictionaryImport } from '@/main/dictionary/dictionary-import';
import { DeepSeekApiRuntime } from '@/main/extensions/deepseek-api/runtime';
import {
  deepSeekVisionEndpointPermission,
  DEEPSEEK_VISION_REFERENCE_PERMISSION,
} from '@/main/extensions/deepseek-api/vision-endpoint';
import { AntigravityCliRuntime } from '@/main/extensions/antigravity-cli/runtime';
import { ExternalImageApiRuntime } from '@/main/extensions/external-image-api/runtime';
import { externalImageApiEndpointPermission } from '@/main/extensions/external-image-api/endpoints';
import { OpenAiImageApiRuntime } from '@/main/extensions/openai-image-api/runtime';
import { ExtensionRegistry } from '@/main/extensions/registry';
import { GenerationCoordinator } from '@/main/generation/coordinator';
import { ModelRuntimeCallRunner } from '@/main/model-runtime/call-runner';
import { DEEPSEEK_TITLE_REQUIREMENT, resolveDeepSeekTitleRoute } from '@/main/model-runtime/deepseek-title-route';
import { ModelRuntimeError } from '@/main/model-runtime/errors';
import type { VideoDocumentGenerationService } from '@/main/video-documents/generation-service';
import type { VideoDocumentTranscriptTranslationService } from '@/main/video-transcript/translation-service';
import { parseModelWorkerMethodParams } from '@/main/model-worker/method-params';
import type { ModelWorkerMethod, ModelWorkerServerMessage, ModelWorkerSnapshot } from '@/main/model-worker/protocol';
import {
  ANTIGRAVITY_CLI_EXTENSION_ID,
  ANTIGRAVITY_CLI_PROVIDER_KEY,
  DEEPSEEK_API_EXTENSION_ID,
  GOOGLE_GEMINI_API_EXTENSION_ID,
  GOOGLE_GEMINI_ASSISTANT_PROVIDER_KEY,
  OPENAI_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';

const unhandled = Symbol('unhandled-model-worker-method');
const modelRuntimeCallRunner = new ModelRuntimeCallRunner();

export interface ModelWorkerRequestDispatcherOptions {
  database: LibraryDatabase;
  agent: AgentGenerationService;
  generation: GenerationCoordinator;
  videoDocuments?: VideoDocumentGenerationService;
  videoDocumentTranslations?: VideoDocumentTranscriptTranslationService;
  codex: CodexAdapter;
  deepSeek: DeepSeekAssistantAdapter;
  antigravity?: AntigravityCliRuntime;
  antigravityAssistant?: AntigravityAssistantAdapter;
  googleGemini?: GoogleGeminiAssistantAdapter;
  imageBreakdown: ImageBreakdownModelAdapter;
  extensions: ExtensionRegistry;
  openAiImageApi: OpenAiImageApiRuntime;
  deepSeekApi: DeepSeekApiRuntime;
  externalImageApis: ExternalImageApiRuntime;
  libraryRoot: string;
  imageTransformWorkerPath: string;
  activeRequestCount(): number;
  beginAssistantJob(): void;
  endAssistantJob(): void;
  snapshot(): ModelWorkerSnapshot;
  broadcast(message: ModelWorkerServerMessage): void;
  broadcastSnapshot(): void;
  scheduleGracefulShutdown(): void;
  scheduleShutdownWhenIdle(): void;
  scheduleForceShutdown(): void;
}

function assertImageBreakdownAccess(
  options: ModelWorkerRequestDispatcherOptions,
  input: Parameters<ImageBreakdownModelAdapter['run']>[0],
) {
  if (input.routeKey === 'ANTIGRAVITY_CLI') {
    if (!options.antigravity || !options.extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID)) {
      throw new Error('Enable the Antigravity CLI extension and grant its required permissions');
    }
    return;
  }
  const extensionId = input.routeKey === 'GOOGLE_GEMINI' ? GOOGLE_GEMINI_API_EXTENSION_ID : DEEPSEEK_API_EXTENSION_ID;
  if (!options.extensions.isActivated(extensionId)) {
    throw new Error('Enable the selected vision model extension and grant its required permissions');
  }
  if (
    input.routeKey === 'DEEPSEEK_VL' &&
    !options.extensions.isPermissionGranted(extensionId, DEEPSEEK_VISION_REFERENCE_PERMISSION)
  ) {
    throw new Error(`Grant extension permission ${DEEPSEEK_VISION_REFERENCE_PERMISSION} before reading the image`);
  }
  const endpointPermission =
    input.routeKey === 'GOOGLE_GEMINI'
      ? externalImageApiEndpointPermission(
          GOOGLE_GEMINI_API_EXTENSION_ID,
          options.externalImageApis.credentials(GOOGLE_GEMINI_API_EXTENSION_ID).settings,
        )
      : deepSeekVisionEndpointPermission(options.deepSeekApi.connectionSnapshot().visionEndpoint);
  if (endpointPermission && !options.extensions.isPermissionGranted(extensionId, endpointPermission)) {
    throw new Error(`Grant extension permission ${endpointPermission} before using this vision endpoint`);
  }
}

function throwIfRequestCancelled(signal: AbortSignal) {
  if (signal.aborted) {
    throw Object.assign(new Error('Background model service request was cancelled'), { code: 'CANCELLED' as const });
  }
}

async function withAssistantJob<T>(
  options: ModelWorkerRequestDispatcherOptions,
  operation: () => Promise<T>,
): Promise<T> {
  options.beginAssistantJob();
  try {
    return await operation();
  } finally {
    options.endAssistantJob();
  }
}

async function executeConfiguredAssistant(
  options: ModelWorkerRequestDispatcherOptions,
  run: NonNullable<ReturnType<LibraryDatabase['getAssistantRun']>>,
  runId: string,
  providerKey: string,
  modelKey: string,
  signal: AbortSignal,
) {
  if (providerKey === DEEPSEEK_PROVIDER_KEY) {
    return await runDeepSeekAssistant(options, runId, run.input, providerKey, modelKey, signal);
  }
  if (providerKey === GOOGLE_GEMINI_ASSISTANT_PROVIDER_KEY) {
    return await runGoogleGeminiAssistant(options, runId, run.input, providerKey, modelKey, signal);
  }
  if (providerKey === ANTIGRAVITY_CLI_PROVIDER_KEY) {
    return await runAntigravityAssistant(options, runId, run.input, providerKey, modelKey, signal);
  }
  if (providerKey !== 'codex') throw new Error(`Unsupported assistant model provider: ${providerKey}`);
  return await options.codex.assist(
    run.input,
    [],
    [],
    {
      scope: run.scope,
      title: run.mode === 'directions' ? '灵感方向' : 'AI帮写',
      operationId: runId,
      model: modelKey === 'codex' ? undefined : modelKey,
      effort: run.reasoningEffort ?? undefined,
    },
    signal,
  );
}

async function runPersistedAssistant(options: ModelWorkerRequestDispatcherOptions, runId: string, signal: AbortSignal) {
  const { database } = options;
  try {
    const run = database.getAssistantRun(runId);
    if (!run) throw new Error('Assistant run is unavailable');
    const providerKey = run.providerKey ?? (run.mode === 'directions' ? DEEPSEEK_PROVIDER_KEY : 'codex');
    const modelKey = run.modelKey ?? (providerKey === DEEPSEEK_PROVIDER_KEY ? DEEPSEEK_DEFAULT_MODEL_ID : 'codex');
    const requested = database.recordAssistantActivity(runId, 'MODEL_REQUESTED', {
      providerKey,
      modelKey,
      message: `Request submitted to ${modelKey}`,
      payload:
        run.reasoningEffort || run.input.webSearchMode === 'REQUIRED'
          ? {
              ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
              ...(run.input.webSearchMode === 'REQUIRED' ? { webSearchMode: 'REQUIRED' } : {}),
            }
          : undefined,
    });
    if (requested) options.broadcast({ type: 'assistant-progress', event: requested });
    const result = await executeConfiguredAssistant(options, run, runId, providerKey, modelKey, signal);
    throwIfRequestCancelled(signal);
    const completed = database.succeedAssistantRun(runId, result);
    const completedEvent = completed.activityEvents?.at(-1);
    if (completedEvent?.phase === 'COMPLETED') {
      options.broadcast({ type: 'assistant-progress', event: completedEvent });
    }
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
    const failed =
      code === 'CANCELLED' ? database.interruptAssistantRun(runId, message) : database.failAssistantRun(runId, message);
    const failedEvent = failed.activityEvents?.at(-1);
    if (failedEvent && ['FAILED', 'INTERRUPTED'].includes(failedEvent.phase)) {
      options.broadcast({ type: 'assistant-progress', event: failedEvent });
    }
    return failed;
  }
}

async function dispatchStorageAndGeneration(
  options: ModelWorkerRequestDispatcherOptions,
  method: ModelWorkerMethod,
  params: unknown[],
  signal: AbortSignal,
) {
  const { database, generation } = options;
  switch (method) {
    case 'library-file-view.refresh':
      parseModelWorkerMethodParams(method, params);
      database.refreshLibraryFileView();
      return undefined;
    case 'agent.asset.import': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return options.agent.importAsset(input, signal);
    }
    case 'agent.draft.prepare': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return options.agent.prepareDraft(input);
    }
    case 'agent.generation.start': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return options.agent.startGeneration(input);
    }
    case 'agent.job.get': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return options.agent.getJob(input);
    }
    case 'agent.job.cancel': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return options.agent.cancelJob(input);
    }
    case 'dictionary.stage-import': {
      const [fileName, filePath] = parseModelWorkerMethodParams(method, params);
      return database.stageImport(fileName, readDictionaryImport(filePath));
    }
    case 'dictionary.commit-import': {
      const [batchId] = parseModelWorkerMethodParams(method, params);
      const result = database.commitImport(batchId);
      database.refreshLibraryFileView();
      return result;
    }
    case 'generation.start': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.start(input);
    }
    case 'generation.start-batch': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.startBatch(input);
    }
    case 'generation.start-image-edit': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.startImageEdit(input);
    }
    case 'generation.start-image-edit-batch': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.startImageEditBatch(input);
    }
    case 'generation.start-image-reframe': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.startImageReframe(input);
    }
    case 'generation.start-codex-image-refinement': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.startCodexImageRefinement(input);
    }
    case 'generation.start-style-exploration': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.startStyleExploration(input);
    }
    case 'generation.cancel-style-exploration': {
      const [batchId] = parseModelWorkerMethodParams(method, params);
      return generation.cancelStyleExploration(batchId);
    }
    case 'generation.retry-style-exploration-slot': {
      const [slotId] = parseModelWorkerMethodParams(method, params);
      return generation.retryStyleExplorationSlot(slotId);
    }
    case 'generation.start-version': {
      const [input] = parseModelWorkerMethodParams(method, params);
      return generation.startVersion(input);
    }
    case 'generation.retry': {
      const [runId] = parseModelWorkerMethodParams(method, params);
      return generation.retry(runId);
    }
    case 'generation.cancel': {
      const [runId] = parseModelWorkerMethodParams(method, params);
      return generation.cancel(runId);
    }
    case 'generation.configure-concurrency': {
      const [configuration] = parseModelWorkerMethodParams(method, params);
      generation.configureConcurrency(configuration);
      options.broadcastSnapshot();
      return undefined;
    }
    default:
      return unhandled;
  }
}

async function dispatchAssistantAndCodex(
  options: ModelWorkerRequestDispatcherOptions,
  method: ModelWorkerMethod,
  params: unknown[],
  signal: AbortSignal,
) {
  const { codex, database, extensions } = options;
  switch (method) {
    case 'codex.refresh-health': {
      parseModelWorkerMethodParams(method, params);
      const health = await codex.refreshHealth(signal);
      options.broadcastSnapshot();
      return health;
    }
    case 'codex.list-models':
      parseModelWorkerMethodParams(method, params);
      return codex.listModels(signal);
    case 'codex.check-article': {
      const [input, execution] = parseModelWorkerMethodParams(method, params);
      return codex.checkArticle(input, execution, signal);
    }
    case 'video-document.article-generate': {
      const [input] = parseModelWorkerMethodParams(method, params);
      if (!options.videoDocuments) throw new Error('Video document generation service is unavailable');
      return withAssistantJob(options, () =>
        options.videoDocuments!.generateArticle(input.documentId, input.noteId, signal),
      );
    }
    case 'video-document.transcript-translate': {
      const [input] = parseModelWorkerMethodParams(method, params);
      if (!options.videoDocumentTranslations) throw new Error('Video document translation service is unavailable');
      return withAssistantJob(options, () => options.videoDocumentTranslations!.translate(input, signal));
    }
    case 'assistant.suggest-titles': {
      const [input, execution] = parseModelWorkerMethodParams(method, params);
      if (execution.providerKey === 'codex') {
        return codex.suggestTitles(
          input,
          { model: execution.modelKey, effort: execution.reasoningEffort ?? undefined },
          signal,
        );
      }
      if (execution.providerKey === 'deepseek') {
        if (!extensions.isActivated(DEEPSEEK_API_EXTENSION_ID)) {
          throw new Error('Enable the DeepSeek API extension and grant its required permissions');
        }
        return withAssistantJob(options, () => runDeepSeekTitleSuggestion(options, input, signal));
      }
      if (execution.providerKey === GOOGLE_GEMINI_ASSISTANT_PROVIDER_KEY) {
        if (!extensions.isActivated(GOOGLE_GEMINI_API_EXTENSION_ID)) {
          throw new Error('Enable the Google Gemini API extension and grant its required permissions');
        }
        if (!options.googleGemini) throw new Error('Google Gemini assistant runtime is unavailable');
        return withAssistantJob(options, () => options.googleGemini!.suggestTitles(input, signal));
      }
      if (execution.providerKey === ANTIGRAVITY_CLI_PROVIDER_KEY) {
        if (!extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID)) {
          throw new Error('Enable the Antigravity CLI extension and grant its required permissions');
        }
        if (!options.antigravityAssistant) throw new Error('Antigravity assistant runtime is unavailable');
        return withAssistantJob(options, () =>
          options.antigravityAssistant!.suggestTitles(input, execution.modelKey, signal),
        );
      }
      throw new Error(`Unsupported title model provider: ${execution.providerKey}`);
    }
    case 'assistant.run': {
      const [runId] = parseModelWorkerMethodParams(method, params);
      return withAssistantJob(options, () => runPersistedAssistant(options, runId, signal));
    }
    case 'image-breakdown.run': {
      const [input] = parseModelWorkerMethodParams(method, params);
      assertImageBreakdownAccess(options, input);
      return withAssistantJob(options, () => options.imageBreakdown.run(input, signal));
    }
    case 'codex.chat': {
      const [job] = parseModelWorkerMethodParams(method, params);
      const processId =
        job.processId ??
        database.startAgentChatProcess(
          job.scope,
          job.history.map((turn) => turn.id),
        );
      if (job.processId) {
        database.assertAgentChatProcessOwnership(
          processId,
          job.scope,
          job.history.map((turn) => turn.id),
        );
      }
      try {
        // processId is an audit correlation key only. The prompt builder receives
        // the explicit bounded history below and never reads process/event tables.
        const result = await codex.assist(
          job.input,
          job.history,
          job.imagePaths,
          {
            scope: job.scope,
            title: '创作记录',
            observer: {
              onTransportSelected: (transport) => database.setAgentChatProcessTransport(processId, transport),
              onTurnStarted: (threadId, turnId) => database.recordAgentChatExternalTurn(processId, threadId, turnId),
              onEvent: (event) => database.recordAgentChatProcessEvent(processId, event),
              onCaptureDegraded: (reason, droppedEventCount, droppedEventCountExact) =>
                database.markAgentChatCaptureDegraded(processId, reason, droppedEventCount, droppedEventCountExact),
            },
          },
          signal,
        );
        throwIfRequestCancelled(signal);
        return database.completeAgentChatProcess(processId, job.scope, job.request, result);
      } catch (error) {
        database.failAgentChatProcess(processId, error);
        throw error;
      }
    }
    case 'codex.suggest-titles': {
      const [input, execution] = parseModelWorkerMethodParams(method, params);
      return codex.suggestTitles(input, execution ?? undefined, signal);
    }
    case 'codex.cancel-all':
      parseModelWorkerMethodParams(method, params);
      codex.cancelStatelessJobs();
      return undefined;
    default:
      return unhandled;
  }
}

async function runDeepSeekTitleSuggestion(
  options: ModelWorkerRequestDispatcherOptions,
  input: Parameters<DeepSeekAssistantAdapter['suggestTitles']>[0],
  signal: AbortSignal,
) {
  const connection = options.deepSeekApi.connectionSnapshot();
  const route = resolveDeepSeekTitleRoute(connection);
  const result = await modelRuntimeCallRunner.run({
    route,
    requirement: DEEPSEEK_TITLE_REQUIREMENT,
    inputManifest: {
      submittedInputModalities: ['TEXT'],
      submittedItemCount: 1,
      submittedBytes: null,
      sourceArtifactIds: [],
      derivedEvidenceIds: [],
    },
    signal,
    bind: (selectedRoute) => {
      const current = options.deepSeekApi.connectionSnapshot();
      if (
        current.configurationRevision !== selectedRoute.connectionRevision ||
        current.modelId !== selectedRoute.modelId
      ) {
        throw new ModelRuntimeError({
          code: 'INPUT_CHANGED',
          phase: 'BINDING_CONNECTION',
          retryable: true,
          providerStarted: false,
          message: 'DeepSeek connection changed before the model call was bound',
        });
      }
      return options.deepSeek.bindTitleSuggestion(input);
    },
    decodeOutput: (value) => decodeDeepSeekTitleResult(input, value),
    resolveActualModelEffectiveCapabilities: (modelId) =>
      modelId === route.modelId ? route.effectiveCapabilities : null,
  });
  return result.output;
}

async function runDeepSeekAssistant(
  options: ModelWorkerRequestDispatcherOptions,
  runId: string,
  input: Parameters<DeepSeekAssistantAdapter['assist']>[0],
  providerKey: string,
  modelKey: string,
  signal: AbortSignal,
) {
  if (!options.extensions.isActivated(DEEPSEEK_API_EXTENSION_ID)) {
    throw new Error('Enable the DeepSeek API extension and grant its required permissions');
  }
  return options.deepSeek.assist(
    input,
    (progress) => {
      const event = options.database.recordAssistantActivity(runId, progress.phase, {
        providerKey,
        modelKey,
        message: progress.message,
        payload: progress.payload,
      });
      if (event) options.broadcast({ type: 'assistant-progress', event });
    },
    signal,
  );
}

async function runGoogleGeminiAssistant(
  options: ModelWorkerRequestDispatcherOptions,
  runId: string,
  input: Parameters<GoogleGeminiAssistantAdapter['assist']>[0],
  providerKey: string,
  modelKey: string,
  signal: AbortSignal,
) {
  if (!options.extensions.isActivated(GOOGLE_GEMINI_API_EXTENSION_ID)) {
    throw new Error('Enable the Google Gemini API extension and grant its required permissions');
  }
  if (!options.googleGemini) throw new Error('Google Gemini assistant runtime is unavailable');
  return options.googleGemini.assist(
    input,
    (progress) => {
      const event = options.database.recordAssistantActivity(runId, progress.phase, {
        providerKey,
        modelKey,
        message: progress.message,
        payload: progress.payload,
      });
      if (event) options.broadcast({ type: 'assistant-progress', event });
    },
    signal,
  );
}

async function runAntigravityAssistant(
  options: ModelWorkerRequestDispatcherOptions,
  runId: string,
  input: Parameters<AntigravityAssistantAdapter['assist']>[0],
  providerKey: string,
  modelKey: string,
  signal: AbortSignal,
) {
  if (!options.extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID)) {
    throw new Error('Enable the Antigravity CLI extension and grant its required permissions');
  }
  if (!options.antigravityAssistant) throw new Error('Antigravity assistant runtime is unavailable');
  return options.antigravityAssistant.assist(
    input,
    modelKey,
    (progress) => {
      const event = options.database.recordAssistantActivity(runId, progress.phase, {
        providerKey,
        modelKey,
        message: progress.message,
        payload: progress.payload,
      });
      if (event) options.broadcast({ type: 'assistant-progress', event });
    },
    signal,
  );
}

async function dispatchExtensionsAndLifecycle(
  options: ModelWorkerRequestDispatcherOptions,
  method: ModelWorkerMethod,
  params: unknown[],
  signal: AbortSignal,
) {
  switch (method) {
    case 'extensions.refresh': {
      parseModelWorkerMethodParams(method, params);
      options.extensions.list();
      const health = await options.codex.refreshHealth(signal);
      if (options.antigravity && options.extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID)) {
        await options.antigravity.refresh(signal);
      }
      options.broadcastSnapshot();
      return health;
    }
    case 'antigravity.refresh-status': {
      parseModelWorkerMethodParams(method, params);
      if (!options.antigravity) throw new Error('Antigravity CLI runtime is unavailable');
      if (!options.extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID)) {
        throw new Error('Antigravity CLI extension is disabled or missing permissions');
      }
      const status = await options.antigravity.refresh(signal);
      options.broadcastSnapshot();
      return status;
    }
    case 'extensions.configure-openai-image-api': {
      const [configuration] = parseModelWorkerMethodParams(method, params);
      options.extensions.list();
      options.openAiImageApi.configure(
        options.extensions.isActivated(OPENAI_IMAGE_API_EXTENSION_ID) ? configuration : null,
      );
      options.broadcastSnapshot();
      return undefined;
    }
    case 'extensions.configure-deepseek-api': {
      const [configuration] = parseModelWorkerMethodParams(method, params);
      options.extensions.list();
      options.deepSeekApi.configure(options.extensions.isActivated(DEEPSEEK_API_EXTENSION_ID) ? configuration : null);
      options.broadcastSnapshot();
      return undefined;
    }
    case 'extensions.configure-external-image-apis': {
      const [configurations] = parseModelWorkerMethodParams(method, params);
      options.extensions.list();
      options.externalImageApis.configure(
        configurations.filter((configuration) => options.extensions.isActivated(configuration.extensionId)),
      );
      options.broadcastSnapshot();
      return undefined;
    }
    case 'worker.shutdown':
      parseModelWorkerMethodParams(method, params);
      if (options.generation.hasPending || options.codex.hasPending || options.activeRequestCount() > 1) {
        throw Object.assign(new Error('Background model service still has active work'), { code: 'WORKER_BUSY' });
      }
      options.scheduleGracefulShutdown();
      return undefined;
    case 'worker.shutdown-when-idle':
      parseModelWorkerMethodParams(method, params);
      options.scheduleShutdownWhenIdle();
      return undefined;
    case 'worker.force-shutdown':
      parseModelWorkerMethodParams(method, params);
      options.scheduleForceShutdown();
      return undefined;
    default:
      return unhandled;
  }
}

export function createModelWorkerRequestDispatcher(options: ModelWorkerRequestDispatcherOptions) {
  return async (method: ModelWorkerMethod, params: unknown[], signal: AbortSignal) => {
    if (method === 'snapshot') {
      parseModelWorkerMethodParams(method, params);
      return options.snapshot();
    }
    const storageResult = await dispatchStorageAndGeneration(options, method, params, signal);
    if (storageResult !== unhandled) return storageResult;
    const assistantResult = await dispatchAssistantAndCodex(options, method, params, signal);
    if (assistantResult !== unhandled) return assistantResult;
    const lifecycleResult = await dispatchExtensionsAndLifecycle(options, method, params, signal);
    if (lifecycleResult !== unhandled) return lifecycleResult;
    throw new Error(`Unknown background model service method: ${String(method)}`);
  };
}
