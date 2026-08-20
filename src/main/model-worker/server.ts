import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DeepSeekAssistantAdapter } from '@/main/assistant-models/deepseek';
import { AntigravityAssistantAdapter } from '@/main/assistant-models/antigravity';
import { GoogleGeminiAssistantAdapter } from '@/main/assistant-models/google-gemini';
import { CodexAdapter } from '@/main/assistant/codex';
import { LibraryDatabase } from '@/main/database';
import { DeepSeekApiRuntime } from '@/main/extensions/deepseek-api/runtime';
import { AntigravityCliRuntime } from '@/main/extensions/antigravity-cli/runtime';
import { ExternalImageApiRuntime } from '@/main/extensions/external-image-api/runtime';
import { OpenAiImageApiRuntime } from '@/main/extensions/openai-image-api/runtime';
import { ExtensionRegistry } from '@/main/extensions/registry';
import { GenerationCoordinator } from '@/main/generation/coordinator';
import { AntigravityImageProvider } from '@/main/generation-models/antigravity-cli/antigravity-image-provider';
import {
  CodexImageModel,
  createExternalImageProviders,
  ImageGenerationRouteRegistry,
  InternalLibraryRandomModel,
  ModelBackedGenerationProvider,
  OpenAiImageProvider,
} from '@/main/generation-models';
import {
  MODEL_WORKER_PROTOCOL_VERSION,
  createModelWorkerClientMessageDecoder,
  encodeWorkerMessage,
  parseModelWorkerDescriptor,
  parseModelWorkerLaunchConfig,
  type ModelWorkerDescriptor,
  type ModelWorkerMethod,
  type ModelWorkerServerMessage,
  type ModelWorkerSnapshot,
} from '@/main/model-worker/protocol';
import { createModelWorkerRequestDispatcher } from '@/main/model-worker/request-dispatcher';
import { VideoDocumentGenerationService } from '@/main/video-documents/generation-service';
import { VideoDocumentTranscriptTranslationService } from '@/main/video-transcript/translation-service';
import {
  ANTIGRAVITY_CLI_EXTENSION_ID,
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_PROVIDER_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
  type ExternalImageApiExtensionId,
} from '@/shared/extension-ids';

function listen(server: net.Server, endpoint: string) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
}

function endpointIsLive(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    const finish = (live: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(live);
    };
    const timer = setTimeout(() => finish(false), 250);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

function readOwnedDescriptor(filePath: string, workerId: string) {
  try {
    return parseModelWorkerDescriptor(readFileSync(filePath, 'utf8'))?.workerId === workerId;
  } catch {
    return false;
  }
}

function publishWorkerDescriptor(temporaryPath: string, descriptorPath: string) {
  try {
    renameSync(temporaryPath, descriptorPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || code !== 'EXDEV' || !existsSync(temporaryPath)) throw error;

    // MSIX can virtualize two logical siblings onto different backing volumes.
    // The descriptor is runtime-only and schema validated by every reader, so a
    // synchronous copy is a safe fallback when the atomic rename is impossible.
    copyFileSync(temporaryPath, descriptorPath);
    try {
      unlinkSync(temporaryPath);
    } catch {
      /* the published descriptor is already complete */
    }
  }
}

function responseError(id: string, reason: unknown): ModelWorkerServerMessage {
  const message = reason instanceof Error ? reason.message : String(reason);
  const code =
    reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string'
      ? reason.code
      : undefined;
  return { type: 'response', id, error: { message, ...(code ? { code } : {}) } };
}

interface WorkerServerOptions {
  token: string;
  e2eReadyDelayMs: number;
  clients: Set<net.Socket>;
  connections: Set<net.Socket>;
  activeRequests: Map<string, AbortController>;
  canAcceptConnection(): boolean;
  shutdownScheduled(): boolean;
  snapshot(): ModelWorkerSnapshot;
  dispatch(method: ModelWorkerMethod, params: unknown[], signal: AbortSignal): Promise<unknown>;
  scheduleIdleExit(): void;
}

function createWorkerServer(options: WorkerServerOptions) {
  return net.createServer((socket) => {
    options.connections.add(socket);
    socket.once('close', () => options.connections.delete(socket));
    if (!options.canAcceptConnection()) {
      socket.destroy();
      return;
    }
    let authenticated = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const authenticationTimer = setTimeout(() => socket.destroy(), 5_000);
    const send = (message: ModelWorkerServerMessage) => {
      if (!socket.destroyed) socket.write(encodeWorkerMessage(message));
    };
    const decode = createModelWorkerClientMessageDecoder((message) => {
      if (!authenticated) {
        if (
          message.type !== 'hello' ||
          message.token !== options.token ||
          message.protocolVersion !== MODEL_WORKER_PROTOCOL_VERSION
        ) {
          send({ type: 'protocol-error', message: 'Background model service authentication failed' });
          socket.end();
          return;
        }
        authenticated = true;
        clearTimeout(authenticationTimer);
        options.clients.add(socket);
        options.scheduleIdleExit();
        const sendReady = () => {
          readyTimer = null;
          if (!socket.destroyed && options.canAcceptConnection()) {
            send({ type: 'ready', snapshot: options.snapshot() });
          }
        };
        if (options.e2eReadyDelayMs > 0) readyTimer = setTimeout(sendReady, options.e2eReadyDelayMs);
        else sendReady();
        return;
      }
      if (message.type === 'cancel') {
        options.activeRequests.get(message.id)?.abort();
        return;
      }
      if (message.type !== 'request') return;
      if (options.shutdownScheduled()) {
        send(
          responseError(
            message.id,
            Object.assign(new Error('Background model service is shutting down'), {
              code: 'WORKER_SHUTTING_DOWN',
            }),
          ),
        );
        return;
      }
      if (options.activeRequests.has(message.id)) {
        send({ type: 'protocol-error', message: 'Duplicate background model service request id' });
        return;
      }
      const controller = new AbortController();
      options.activeRequests.set(message.id, controller);
      void options
        .dispatch(message.method, message.params, controller.signal)
        .then((result) => send({ type: 'response', id: message.id, result: result ?? null }))
        .catch((error) => send(responseError(message.id, error)))
        .finally(() => {
          options.activeRequests.delete(message.id);
          options.scheduleIdleExit();
        });
    });
    socket.on('data', (chunk) => {
      try {
        decode(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      clearTimeout(authenticationTimer);
      if (readyTimer) clearTimeout(readyTimer);
      options.clients.delete(socket);
      options.scheduleIdleExit();
    });
  });
}

async function acquireWorkerEndpoint(server: net.Server, endpoint: string) {
  if (process.platform !== 'win32' && existsSync(endpoint)) {
    if (await endpointIsLive(endpoint)) {
      throw Object.assign(new Error('Another background model service owns this library'), { code: 'EADDRINUSE' });
    }
    try {
      unlinkSync(endpoint);
    } catch {
      /* listen remains authoritative */
    }
  }
  await listen(server, endpoint);
}

function createWorkerSnapshot(
  runtimeFingerprint: string,
  workerId: string,
  generation: GenerationCoordinator | null,
  codex: CodexAdapter | null,
  antigravity: AntigravityCliRuntime,
  activeAssistantJobs: number,
): ModelWorkerSnapshot {
  if (!generation || !codex) throw new Error('Background model service is still starting');
  return {
    protocolVersion: MODEL_WORKER_PROTOCOL_VERSION,
    runtimeFingerprint,
    workerId,
    codexHealth: codex.cachedHealth,
    codexPendingCount: codex.pendingCount + activeAssistantJobs,
    antigravityCliStatus: antigravity.status,
    imageGenerationRoutes: generation.imageGenerationRoutes,
    generationTasks: generation.tasks,
  };
}

function broadcastWorkerMessage(clients: ReadonlySet<net.Socket>, message: ModelWorkerServerMessage) {
  const encoded = encodeWorkerMessage(message);
  for (const client of clients) {
    if (!client.destroyed) client.write(encoded);
  }
}

function installWorkerShutdownSignalHandlers(shutdown: () => Promise<void>) {
  const interruptAndExit = () => void shutdown().finally(() => process.exit(0));
  process.once('SIGINT', interruptAndExit);
  process.once('SIGTERM', interruptAndExit);
}

function createImageGenerationRoutes(options: {
  database: LibraryDatabase;
  codex: CodexAdapter;
  extensions: ExtensionRegistry;
  openAiImageApi: OpenAiImageApiRuntime;
  externalImageApis: ExternalImageApiRuntime;
  antigravity: AntigravityCliRuntime;
  libraryRoot: string;
  internalModelsEnabled: boolean;
}) {
  const {
    database,
    codex,
    extensions,
    openAiImageApi,
    externalImageApis,
    antigravity,
    libraryRoot,
    internalModelsEnabled,
  } = options;
  return new ImageGenerationRouteRegistry([
    new ModelBackedGenerationProvider(
      { id: CODEX_PROVIDER_ID, name: 'Codex', extensionId: CODEX_APP_SERVER_EXTENSION_ID },
      [new CodexImageModel(codex, 'cli'), new CodexImageModel(codex, 'app-server')],
    ),
    ...(internalModelsEnabled
      ? [
          new ModelBackedGenerationProvider({ id: 'internal', name: 'Internal', extensionId: null }, [
            new InternalLibraryRandomModel(database),
          ]),
        ]
      : []),
    new OpenAiImageProvider(database, libraryRoot, openAiImageApi, () =>
      extensions.isActivated(OPENAI_IMAGE_API_EXTENSION_ID),
    ),
    new AntigravityImageProvider(database, antigravity, libraryRoot, () =>
      extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID),
    ),
    ...createExternalImageProviders(
      database,
      libraryRoot,
      externalImageApis,
      (extensionId: ExternalImageApiExtensionId) => extensions.isActivated(extensionId),
    ),
  ]);
}

function configuredE2eReadyDelay() {
  if (process.env.AIY_E2E !== '1') return 0;
  return Math.max(0, Math.min(10_000, Number(process.env.AIY_E2E_MODEL_WORKER_READY_DELAY_MS) || 0));
}

function createWorkerRuntimes(libraryRoot: string) {
  const deepSeekApi = new DeepSeekApiRuntime();
  const antigravity = new AntigravityCliRuntime();
  const externalImageApis = new ExternalImageApiRuntime();
  return {
    deepSeekApi,
    deepSeek: new DeepSeekAssistantAdapter(deepSeekApi),
    antigravity,
    antigravityAssistant: new AntigravityAssistantAdapter(antigravity, libraryRoot),
    openAiImageApi: new OpenAiImageApiRuntime(),
    externalImageApis,
    googleGemini: new GoogleGeminiAssistantAdapter(externalImageApis),
  };
}

function refreshInitialConnections(
  codex: CodexAdapter,
  antigravity: AntigravityCliRuntime,
  extensions: ExtensionRegistry,
  onSettled: () => void,
) {
  const antigravityStartup = extensions.isActivated(ANTIGRAVITY_CLI_EXTENSION_ID)
    ? antigravity.refresh()
    : Promise.resolve();
  void Promise.allSettled([codex.refreshHealth(), antigravityStartup]).then(onSettled);
}

export async function runModelWorker() {
  const config = parseModelWorkerLaunchConfig(process.env.AIY_MODEL_WORKER_CONFIG);
  delete process.env.AIY_MODEL_WORKER_CONFIG;
  const e2eReadyDelayMs = configuredE2eReadyDelay();

  let database: LibraryDatabase | null = null;
  let codex: CodexAdapter | null = null;
  const runtimes = createWorkerRuntimes(config.libraryRoot);
  let extensions: ExtensionRegistry | null = null;
  let generation: GenerationCoordinator | null = null;
  let dispatchRequest: ReturnType<typeof createModelWorkerRequestDispatcher> | null = null;
  let closing = false;
  let descriptorWritten = false;
  let temporaryDescriptorPath: string | null = null;
  let shutdownWhenIdle = false;
  let gracefulShutdownScheduled = false;
  let activeAssistantJobs = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const clients = new Set<net.Socket>();
  const connections = new Set<net.Socket>();
  const activeRequests = new Map<string, AbortController>();
  const snapshot = () =>
    createWorkerSnapshot(
      config.runtimeFingerprint,
      config.workerId,
      generation,
      codex,
      runtimes.antigravity,
      activeAssistantJobs,
    );
  const broadcast = (message: ModelWorkerServerMessage) => broadcastWorkerMessage(clients, message);

  const server = createWorkerServer({
    token: config.token,
    e2eReadyDelayMs,
    clients,
    connections,
    activeRequests,
    canAcceptConnection: () => Boolean(generation && dispatchRequest && !closing),
    shutdownScheduled: () => gracefulShutdownScheduled,
    snapshot,
    dispatch(method, params, signal) {
      const dispatcher = dispatchRequest;
      if (!dispatcher) return Promise.reject(new Error('Background model service is still starting'));
      return dispatcher(method, params, signal);
    },
    scheduleIdleExit,
  });

  // The endpoint is the singleton lock; database recovery starts only after it is acquired.
  await acquireWorkerEndpoint(server, config.endpoint);
  try {
    database = new LibraryDatabase(config.databasePath, config.libraryRoot, { openMode: 'must-exist' });
    database.initializeModelWorker();
    database.interruptVideoDocumentGenerations();
    extensions = new ExtensionRegistry(database, {
      codexHealth: () =>
        codex?.cachedHealth ?? {
          state: 'checking',
          version: '',
          authenticated: false,
          message: 'Checking local Codex',
        },
      openAiImageApiStatus: () => runtimes.openAiImageApi.status(),
      deepSeekApiStatus: () => runtimes.deepSeekApi.status(),
      antigravityCliStatus: () => runtimes.antigravity.status,
      externalImageApiStatus: (extensionId) => runtimes.externalImageApis.status(extensionId),
    });
    codex = new CodexAdapter(database, config.libraryRoot, undefined, undefined, undefined, {
      manageGenerationJobs: true,
      manageStatelessJobs: true,
      isExtensionActivated: () => extensions?.isActivated(CODEX_APP_SERVER_EXTENSION_ID) === true,
    });
    // CLI stays first to preserve the working pinned-runtime default. The two
    // Codex descriptors still have independent connection and route identities.
    const imageGenerationRoutes = createImageGenerationRoutes({
      database,
      codex,
      extensions,
      openAiImageApi: runtimes.openAiImageApi,
      externalImageApis: runtimes.externalImageApis,
      antigravity: runtimes.antigravity,
      libraryRoot: config.libraryRoot,
      internalModelsEnabled: config.internalModelsEnabled,
    });
    generation = new GenerationCoordinator(database, imageGenerationRoutes);
    const videoDocuments = new VideoDocumentGenerationService(database, codex);
    const videoDocumentTranslations = new VideoDocumentTranscriptTranslationService(database, codex);
    generation.on('changed', (event) => {
      broadcast({ type: 'generation-changed', event });
      scheduleIdleExit();
    });
    codex.onPendingChanged(() => {
      broadcast({ type: 'snapshot', snapshot: snapshot() });
      scheduleIdleExit();
    });
    dispatchRequest = createModelWorkerRequestDispatcher({
      database,
      generation,
      videoDocuments,
      videoDocumentTranslations,
      codex,
      deepSeek: runtimes.deepSeek,
      antigravity: runtimes.antigravity,
      antigravityAssistant: runtimes.antigravityAssistant,
      googleGemini: runtimes.googleGemini,
      extensions,
      openAiImageApi: runtimes.openAiImageApi,
      deepSeekApi: runtimes.deepSeekApi,
      externalImageApis: runtimes.externalImageApis,
      libraryRoot: config.libraryRoot,
      imageTransformWorkerPath: config.imageTransformWorkerPath,
      activeRequestCount: () => activeRequests.size,
      beginAssistantJob() {
        activeAssistantJobs += 1;
        broadcast({ type: 'snapshot', snapshot: snapshot() });
      },
      endAssistantJob() {
        activeAssistantJobs = Math.max(0, activeAssistantJobs - 1);
        broadcast({ type: 'snapshot', snapshot: snapshot() });
        scheduleIdleExit();
      },
      snapshot,
      broadcast,
      broadcastSnapshot() {
        broadcast({ type: 'snapshot', snapshot: snapshot() });
      },
      scheduleGracefulShutdown() {
        shutdownWhenIdle = true;
        gracefulShutdownScheduled = true;
        setImmediate(() => {
          void shutdown(false).finally(() => process.exit(0));
        });
      },
      scheduleShutdownWhenIdle() {
        shutdownWhenIdle = true;
        scheduleIdleExit();
      },
      scheduleForceShutdown() {
        setImmediate(() => {
          const hardExitTimer = setTimeout(() => process.exit(0), 2_000);
          void shutdown(true).finally(() => {
            clearTimeout(hardExitTimer);
            process.exit(0);
          });
        });
      },
    });

    const descriptor: ModelWorkerDescriptor = {
      protocolVersion: MODEL_WORKER_PROTOCOL_VERSION,
      runtimeFingerprint: config.runtimeFingerprint,
      workerId: config.workerId,
      token: config.token,
      endpoint: config.endpoint,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    mkdirSync(path.dirname(config.descriptorPath), { recursive: true });
    temporaryDescriptorPath = `${config.descriptorPath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryDescriptorPath, JSON.stringify(descriptor), { encoding: 'utf8', mode: 0o600 });
    publishWorkerDescriptor(temporaryDescriptorPath, config.descriptorPath);
    temporaryDescriptorPath = null;
    descriptorWritten = true;

    refreshInitialConnections(codex, runtimes.antigravity, extensions, () =>
      broadcast({ type: 'snapshot', snapshot: snapshot() }),
    );
    scheduleIdleExit();
  } catch (error) {
    closing = true;
    dispatchRequest = null;
    for (const socket of connections) socket.destroy();
    connections.clear();
    clients.clear();
    generation?.dispose();
    generation = null;
    await codex?.dispose();
    codex = null;
    extensions = null;
    database?.close();
    database = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (temporaryDescriptorPath) {
      try {
        unlinkSync(temporaryDescriptorPath);
      } catch {
        /* already removed */
      }
    }
    if (descriptorWritten && readOwnedDescriptor(config.descriptorPath, config.workerId)) {
      try {
        unlinkSync(config.descriptorPath);
      } catch {
        /* already removed */
      }
    }
    if (process.platform !== 'win32') {
      try {
        unlinkSync(config.endpoint);
      } catch {
        /* already removed */
      }
    }
    throw error;
  }

  function scheduleIdleExit() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (
      closing ||
      clients.size > 0 ||
      activeRequests.size > 0 ||
      generation?.hasPending ||
      codex?.hasPending ||
      activeAssistantJobs > 0
    )
      return;
    idleTimer = setTimeout(() => void shutdown(false), shutdownWhenIdle ? 250 : config.idleExitMs);
  }

  async function shutdown(interruptRunning: boolean) {
    if (closing) return;
    if (
      !interruptRunning &&
      (activeRequests.size > 0 || generation?.hasPending || codex?.hasPending || activeAssistantJobs > 0)
    )
      return;
    closing = true;
    dispatchRequest = null;
    if (idleTimer) clearTimeout(idleTimer);
    for (const controller of activeRequests.values()) controller.abort();
    activeRequests.clear();
    for (const socket of connections) socket.destroy();
    connections.clear();
    clients.clear();
    generation?.dispose();
    generation = null;
    runtimes.openAiImageApi.clear();
    runtimes.deepSeekApi.clear();
    runtimes.externalImageApis.clear();
    await codex?.dispose();
    codex = null;
    extensions = null;
    database?.close();
    database = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (readOwnedDescriptor(config.descriptorPath, config.workerId)) {
      try {
        unlinkSync(config.descriptorPath);
      } catch {
        /* already removed */
      }
    }
    if (process.platform !== 'win32') {
      try {
        unlinkSync(config.endpoint);
      } catch {
        /* already removed */
      }
    }
  }

  installWorkerShutdownSignalHandlers(() => shutdown(true));
}
