import { app, BrowserWindow, dialog, protocol, safeStorage, session } from 'electron';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { LibraryDatabase } from '@/main/database';
import { ExtensionRegistry } from '@/main/extensions/registry';
import { CodexImageDiscovery } from '@/main/extensions/codex-image-discovery';
import { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import { LocalQwenAsrSidecarManager } from '@/main/extensions/local-qwen-asr/sidecar-manager';
import { AssistantRoutingConfiguration } from '@/main/assistant/assistant-routing';
import { GenerationConcurrencyConfiguration } from '@/main/generation/concurrency-configuration';
import { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import { registerIpc } from '@/main/ipc/register-ipc';
import { AppUpdateService } from '@/main/app/app-update-service';
import { DesktopApplicationShell } from '@/main/app/application-shell';
import { applyMediaResponseHeaders, CONTEXT_INDEPENDENT_MEDIA_HOSTS, fetchLocalFile } from '@/main/app/media-response';
import { TransitionPreviewCache, TRANSITION_PREVIEW_LIMIT } from '@/main/app/transition-preview-cache';
import { createTransitionPreviewRatingRefreshScheduler } from '@/main/app/transition-preview-rating-refresh';
import { registerAppUpdateIpc } from '@/main/ipc/app-update-handlers';
import { createTrustedIpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { installStarterContentPack } from '@/main/content-packs/starter-pack-installer';
import { MediaThumbnailCache, normalizeMediaThumbnailSize } from '@/main/media/media-thumbnail-cache';
import { resolveVideoKeyChangeMediaPath } from '@/main/video-documents/key-change-service';
import { VideoDocumentTranscriptBackgroundTaskRegistry } from '@/main/video-transcript/background-task-registry';
import { ImageTransformService } from '@/main/media/image-transform-service';
import { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import { installRendererProtocol, RENDERER_SCHEME } from '@/main/app/renderer-protocol';
import { installSessionSecurityPolicy } from '@/main/app/window-security';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { LibraryRegistry, libraryDatabasePath, type LibraryDescriptor } from '@/main/libraries/library-registry';
import { LegacySpaceMigrationService } from '@/main/libraries/legacy-space-migration';
import { createLegacySpaceMigrationActions } from '@/main/libraries/legacy-space-migration-controller';
import { legacyUserDataRoots, localSpaceForbiddenDestinationRoots } from '@/main/libraries/legacy-user-data-roots';
import { prepareLocalSpaceCover } from '@/main/libraries/local-space-cover';
import { LocalSpaceTransferService } from '@/main/libraries/local-space-transfer';
import { createLocalSpaceTransferActions } from '@/main/libraries/local-space-transfer-controller';
import { LibraryContextLifecycle } from '@/main/libraries/library-context-lifecycle';
import { BackgroundGenerationClient } from '@/main/model-worker/client';
import type {
  GenerationChangedEvent,
  LocalSpaceDescriptorDto,
  LocalSpaceTransitionEvent,
  LocalSpaceTransitionStage,
  LocalSpaceTransferProgressEvent,
  ModelWorkerStatusDto,
  TransitionPreviewDto,
} from '@/shared/contracts';
import {
  DEFAULT_PRODUCT_NAME,
  productNameForLocale,
  STORE_USER_DATA_DIRECTORY_NAME,
  USER_DATA_DIRECTORY_NAME,
} from '@/shared/product';
import {
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  OPENAI_IMAGE_PROVIDER_KEY,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
  type ExternalImageApiExtensionId,
} from '@/shared/extension-ids';

const imageApiExtensionByProvider: Partial<Record<string, ExternalImageApiExtensionId>> = {
  google: GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  'alibaba-cloud': ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  volcengine: VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
  {
    scheme: 'aiy-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);
const rendererEvents = new RendererEventDispatcher();
const localQwenAsrSidecar = new LocalQwenAsrSidecarManager();
const transcriptBackgroundTasks = new VideoDocumentTranscriptBackgroundTaskRegistry();
let legacySpaceMigration: LegacySpaceMigrationService | null = null;
let localSpaceTransfer: LocalSpaceTransferService | null = null;
const appShell = new DesktopApplicationShell(rendererEvents, {
  backgroundColor: '#f8f7f3',
  title: productNameForLocale(app.getLocale()),
  backgroundModelTasks: transcriptBackgroundTasks,
  stopManagedLocalModels: () => localQwenAsrSidecar.dispose(),
  stopBackgroundFileOperations: () =>
    Promise.all([
      legacySpaceMigration?.dispose() ?? Promise.resolve(),
      localSpaceTransfer?.dispose() ?? Promise.resolve(),
    ]).then(() => undefined),
});
transcriptBackgroundTasks.onChanged((event) => {
  rendererEvents.send('video-document:transcript-background-tasks-changed', event);
  appShell.updateAppTray();
});
let libraryRegistry: LibraryRegistry | null = null;
let startupFailureReported = false;
let nextLibraryContextEpoch = 0;
const libraryContextStorage = new AsyncLocalStorage<ActiveLibraryContext>();

function liveServiceProxy<T extends object>(resolve: (context: ActiveLibraryContext) => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const context = libraryContextStorage.getStore() ?? appShell.activeLibraryContext;
      if (!context) throw new Error('Library services are unavailable');
      const service = resolve(context);
      const value = Reflect.get(service, property, service) as unknown;
      return typeof value === 'function' ? value.bind(service) : value;
    },
    set(_target, property, value) {
      const context = libraryContextStorage.getStore() ?? appShell.activeLibraryContext;
      if (!context) throw new Error('Library services are unavailable');
      return Reflect.set(resolve(context), property, value);
    },
  });
}

const configuredUserDataPath = process.env.AIY_USER_DATA_DIR?.trim();
const userDataDirectoryName = process.windowsStore ? STORE_USER_DATA_DIRECTORY_NAME : USER_DATA_DIRECTORY_NAME;
const userDataPath = configuredUserDataPath
  ? path.resolve(configuredUserDataPath)
  : path.resolve(app.getPath('appData'), userDataDirectoryName);
const configuredLegacyUserDataPath = process.env.AIY_LEGACY_USER_DATA_DIR?.trim();
const legacyUserDataPath = configuredLegacyUserDataPath ? path.resolve(configuredLegacyUserDataPath) : null;
const forbiddenLocalSpaceDestinationRoots = localSpaceForbiddenDestinationRoots({
  appDataRoot: app.getPath('appData'),
  homeRoot: app.getPath('home'),
  localAppDataRoot: process.env.LOCALAPPDATA,
});
app.setPath('userData', userDataPath);
app.setName(DEFAULT_PRODUCT_NAME);

const ownsSingleInstanceLock = app.requestSingleInstanceLock();
if (!ownsSingleInstanceLock) app.quit();

if (ownsSingleInstanceLock)
  app
    .whenReady()
    .then(async () => {
      if (process.platform === 'win32') appShell.ensureAppTray();
      const updates = new AppUpdateService((state) => {
        rendererEvents.send('app-update:changed', state);
      });
      appShell.setAppUpdates(updates);
      registerAppUpdateIpc(
        createTrustedIpcHandlerRegistrar(() => appShell.mainWindow),
        {
          getState: () => updates.getState(),
          check: () => updates.check(),
          download: () => updates.download(),
          install: () => updates.install(appShell.prepareAppUpdateInstall, appShell.relaunchAfterFailedUpdateInstall),
        },
      );
      const transitionPreviews = new TransitionPreviewCache(path.join(app.getPath('userData'), 'space-previews'));
      libraryRegistry = new LibraryRegistry(app.getPath('userData'));
      let activeLibrary = libraryRegistry.initialize();
      const discoveredLegacyUserDataRoots = await legacyUserDataRoots({
        configuredRoot: legacyUserDataPath,
        currentUserDataRoot: app.getPath('userData'),
        appDataRoot: app.getPath('appData'),
        homeRoot: app.getPath('home'),
      });
      legacySpaceMigration = new LegacySpaceMigrationService({
        legacyUserDataRoots: discoveredLegacyUserDataRoots,
        currentUserDataRoot: app.getPath('userData'),
        forbiddenDestinationRoots: forbiddenLocalSpaceDestinationRoots,
      });
      localSpaceTransfer = new LocalSpaceTransferService({
        applicationVersion: app.getVersion(),
        temporaryRoot: path.join(app.getPath('temp'), 'aiy-space-transfer'),
        forbiddenDestinationRoots: forbiddenLocalSpaceDestinationRoots,
      });
      const initializeLibrary = (target: LibraryDatabase, library: LibraryDescriptor) => {
        target.initialize(
          library.name,
          { id: library.id, name: library.name, createdAt: library.createdAt },
          {
            recoverGenerationRuns: false,
            recoverAssistantRuns: false,
          },
        );
      };
      const internalModelsEnabled = import.meta.env.DEV;
      const connectionDirectory = path.join(app.getPath('userData'), 'connections');
      const secretProtector: SecretProtector = {
        isAvailable: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        protect: (value) => safeStorage.encryptString(value),
        unprotect: (value) => safeStorage.decryptString(value),
      };
      const openAiImageApi = new OpenAiImageApiConnection(
        path.join(connectionDirectory, 'openai-image-api.json'),
        secretProtector,
      );
      const deepSeekApi = new DeepSeekApiConnection(
        path.join(connectionDirectory, 'deepseek-api.json'),
        secretProtector,
      );
      const assistantRouting = new AssistantRoutingConfiguration(
        path.join(connectionDirectory, 'assistant-routing.json'),
      );
      const generationConcurrency = new GenerationConcurrencyConfiguration(
        path.join(app.getPath('userData'), 'configuration', 'image-generation-concurrency.json'),
      );
      const externalImageApis = new ExternalImageApiConnections(connectionDirectory, secretProtector);
      const configuredWorkerIdleExitMs = Number(process.env.AIY_MODEL_WORKER_IDLE_EXIT_MS);
      const bundledExtensionsPath = app.isPackaged
        ? path.join(process.resourcesPath, 'extensions')
        : path.join(app.getAppPath(), 'extensions');
      const bundledContentPacksPath = app.isPackaged
        ? path.join(process.resourcesPath, 'content-packs')
        : path.join(app.getAppPath(), 'content-packs');
      const starterContentPackPath = path.join(bundledContentPacksPath, 'creation-starter');
      const bundledConfigurationPath = app.isPackaged
        ? path.join(process.resourcesPath, 'configuration')
        : path.join(app.getAppPath(), 'configuration');
      const extensionRoots = [
        { rootPath: bundledExtensionsPath, source: 'BUILT_IN' as const },
        { rootPath: path.join(app.getPath('userData'), 'extensions'), source: 'LOCAL' as const },
      ];

      const createLibraryContext = async (
        library: LibraryDescriptor,
        reportProgress?: (stage: LocalSpaceTransitionStage, progress: number) => void,
      ): Promise<ActiveLibraryContext> => {
        const startedAt = Date.now();
        reportProgress?.('OPENING_DATABASE', 20);
        const createsDatabase = libraryRegistry?.requiresDatabaseCreation(library.id) === true;
        const targetDatabase = new LibraryDatabase(libraryDatabasePath(library), library.rootPath, {
          openMode: createsDatabase ? 'create' : 'must-exist',
        });
        let targetGeneration: BackgroundGenerationClient | null = null;
        let targetImageDiscovery: CodexImageDiscovery | null = null;
        const targetThumbnails = new MediaThumbnailCache(library.rootPath);
        const targetImageTransforms = new ImageTransformService(targetDatabase);
        try {
          initializeLibrary(targetDatabase, library);
          if (createsDatabase) libraryRegistry?.markDatabaseCreated(library.id);
          reportProgress?.('CONNECTING_SERVICES', 55);
          targetImageDiscovery = new CodexImageDiscovery(targetDatabase);
          targetGeneration = await BackgroundGenerationClient.create({
            databasePath: libraryDatabasePath(library),
            libraryRoot: library.rootPath,
            workerBundlePath: path.join(app.getAppPath(), 'out', 'main', 'model-worker.js'),
            internalModelsEnabled,
            cropImage: (input) => targetImageTransforms.crop(input),
            ...(Number.isFinite(configuredWorkerIdleExitMs) && configuredWorkerIdleExitMs >= 1_000
              ? { idleExitMs: configuredWorkerIdleExitMs }
              : {}),
          });
          targetDatabase.setLibraryFileViewBackgroundSynchronizer(() =>
            targetGeneration!.callWorker<void>('library-file-view.refresh', [], 120_000),
          );
          const targetCodex = targetGeneration.codex;
          const targetAssistant = targetGeneration.assistant;
          reportProgress?.('LOADING_EXTENSIONS', 72);
          const targetExtensions: ExtensionRegistry = new ExtensionRegistry(targetDatabase, {
            extensionRoots,
            codexHealth: () => targetCodex.cachedHealth,
            antigravityCliStatus: () => targetGeneration!.antigravityCliStatus,
            codexImageDiscoveryStatus: () => targetImageDiscovery!.status(),
            openAiImageApiStatus: () => {
              const status = openAiImageApi.status();
              return {
                configured: status.configured,
                usable: status.status === 'READY' || status.status === 'UNVERIFIED',
                message: status.message,
              };
            },
            deepSeekApiStatus: () => {
              const status = deepSeekApi.status();
              return { configured: status.configured, ready: status.status === 'READY', message: status.message };
            },
            externalImageApiStatus: (extensionId) => {
              const status = externalImageApis.status(extensionId);
              const permissionRequired = externalImageApis.endpointPermission(extensionId);
              const endpointAuthorized =
                !permissionRequired || targetExtensions.isPermissionGranted(extensionId, permissionRequired);
              return {
                configured: status.configured,
                usable: endpointAuthorized && (status.status === 'READY' || status.status === 'UNVERIFIED'),
                message: endpointAuthorized
                  ? status.message
                  : `Grant extension permission ${permissionRequired} to use this endpoint`,
                permissionRequired: endpointAuthorized ? null : permissionRequired,
              };
            },
          });
          const externalImageApiRuntimeConfigurations = () =>
            externalImageApis.runtimeConfigurations((extensionId, permission) =>
              targetExtensions.isPermissionGranted(extensionId, permission),
            );
          const refreshOpenAiImageApiRuntimeConfiguration = () => {
            void targetGeneration!.configureOpenAiImageApi(openAiImageApi.runtimeConfiguration()).catch((error) => {
              console.error('[openai-image-api] failed to refresh worker verification', error);
            });
          };
          reportProgress?.('APPLYING_SETTINGS', 82);
          await targetGeneration.configureOpenAiImageApi(openAiImageApi.runtimeConfiguration());
          await targetGeneration.configureDeepSeekApi(deepSeekApi.runtimeConfiguration());
          await targetGeneration.configureExternalImageApis(externalImageApiRuntimeConfigurations());
          await targetGeneration.configureConcurrency(generationConcurrency.get());

          let activated = false;
          let backgroundServicesStarted = false;
          let backgroundStartTimer: ReturnType<typeof setTimeout> | null = null;
          let discoveryStartTimer: ReturnType<typeof setTimeout> | null = null;
          let unsubscribeCodexPending: (() => void) | null = null;
          let unsubscribeAssistantProgress: (() => void) | null = null;
          const onGenerationChanged = (event: GenerationChangedEvent) => {
            if (event.terminal || !event.runId) targetDatabase.scheduleLibraryFileViewSynchronization();
            if (event.terminal && event.runId) {
              try {
                const job = targetDatabase.getGenerationJob(event.runId);
                const modelProviderKey = targetDatabase.getGenerationRunModelKey(event.runId)?.split('/')[0];
                const providerKey = job?.providerKey || modelProviderKey;
                const extensionId = providerKey ? imageApiExtensionByProvider[providerKey] : undefined;
                if (providerKey === OPENAI_IMAGE_PROVIDER_KEY && job?.status === 'SUCCEEDED') {
                  openAiImageApi.markVerified(job.providerRequestId);
                  refreshOpenAiImageApiRuntimeConfiguration();
                } else if (providerKey === OPENAI_IMAGE_PROVIDER_KEY && job?.errorCode === 'AUTH') {
                  openAiImageApi.markConnectionError(job.errorMessage || 'OpenAI rejected the API credentials');
                  refreshOpenAiImageApiRuntimeConfiguration();
                } else if (job?.status === 'SUCCEEDED' && extensionId) {
                  externalImageApis.markVerified(extensionId, job.providerRequestId);
                  void targetGeneration!
                    .configureExternalImageApis(externalImageApiRuntimeConfigurations())
                    .catch((error) => {
                      console.error('[external-image-api] failed to refresh worker verification', error);
                    });
                } else if (job?.errorCode === 'AUTH' && extensionId) {
                  externalImageApis.markConnectionError(
                    extensionId,
                    job.errorMessage || 'Provider rejected the API credentials',
                  );
                  void targetGeneration!
                    .configureExternalImageApis(externalImageApiRuntimeConfigurations())
                    .catch((error) => {
                      console.error('[external-image-api] failed to refresh worker verification', error);
                    });
                }
              } catch (error) {
                console.error('[image-api] failed to persist connection state', error);
              }
            }
            if (!activated) return;
            rendererEvents.send('generation:changed', event);
            appShell.updateAppTray();
          };
          const onWorkerStatusChanged = (status: ModelWorkerStatusDto) => {
            if (activated) rendererEvents.send('model-worker:changed', status);
          };
          const onDiscoveryChanged = () => {
            if (activated) rendererEvents.send('codex-generated-images:changed');
          };
          const lifecycle = new LibraryContextLifecycle();
          const context: ActiveLibraryContext = {
            epoch: ++nextLibraryContextEpoch,
            get state() {
              return lifecycle.state;
            },
            library,
            database: targetDatabase,
            generation: targetGeneration,
            codex: targetCodex,
            assistant: targetAssistant,
            imageDiscovery: targetImageDiscovery,
            extensions: targetExtensions,
            thumbnails: targetThumbnails,
            acquireOperation() {
              return lifecycle.acquireOperation();
            },
            drain() {
              return lifecycle.drain();
            },
            resume() {
              lifecycle.resume();
            },
            activate() {
              if (activated) return;
              lifecycle.activate();
              activated = true;
              targetGeneration!.on('changed', onGenerationChanged);
              targetGeneration!.on('worker-status-changed', onWorkerStatusChanged);
              targetImageDiscovery!.on('changed', onDiscoveryChanged);
              unsubscribeCodexPending = targetCodex.onPendingChanged(appShell.updateAppTray);
              unsubscribeAssistantProgress = targetAssistant.onProgress((event) => {
                rendererEvents.send('assistant-run:progress', event);
              });
            },
            startBackgroundServices() {
              if (!activated || backgroundServicesStarted || backgroundStartTimer) return;
              backgroundStartTimer = setTimeout(() => {
                backgroundStartTimer = null;
                if (!activated || backgroundServicesStarted) return;
                backgroundServicesStarted = true;
                try {
                  targetDatabase.startLibraryFileViewSynchronization();
                } catch (error) {
                  console.error('[library-file-view] initial synchronization failed', error);
                }
                let previewRefresh: Promise<TransitionPreviewDto[] | null> = Promise.resolve(null);
                try {
                  const previewSources = targetDatabase.listTransitionPreviewSources(TRANSITION_PREVIEW_LIMIT);
                  previewRefresh = transitionPreviews.refresh(library.id, previewSources);
                } catch (error) {
                  console.warn('[local-space] failed to collect transition previews', {
                    libraryId: library.id,
                    error,
                  });
                }
                void previewRefresh
                  .then((previews) => {
                    if (!activated || !previews) return;
                    rendererEvents.send('app:loading-previews-refreshed', { spaceId: library.id, previews });
                  })
                  .finally(() => {
                    if (!activated || discoveryStartTimer) return;
                    discoveryStartTimer = setTimeout(() => {
                      discoveryStartTimer = null;
                      if (!activated) return;
                      void targetImageDiscovery!
                        .setActive(targetExtensions.isActivated(CODEX_IMAGE_DISCOVERY_EXTENSION_ID))
                        .catch((error) => {
                          console.error('[codex-image-discovery] initial scan failed', error);
                        });
                    }, 500);
                  });
              }, 750);
            },
            dispose() {
              return lifecycle.dispose(async () => {
                activated = false;
                if (backgroundStartTimer) clearTimeout(backgroundStartTimer);
                backgroundStartTimer = null;
                if (discoveryStartTimer) clearTimeout(discoveryStartTimer);
                discoveryStartTimer = null;
                unsubscribeCodexPending?.();
                unsubscribeAssistantProgress?.();
                unsubscribeCodexPending = null;
                targetGeneration!.off('changed', onGenerationChanged);
                targetGeneration!.off('worker-status-changed', onWorkerStatusChanged);
                targetImageDiscovery!.off('changed', onDiscoveryChanged);
                await targetDatabase.drainLibraryFileViewSynchronization();
                await targetThumbnails.dispose();
                targetGeneration!.dispose();
                await targetImageDiscovery!.dispose();
                targetDatabase.close();
              });
            },
          };
          console.info('[local-space] context ready', {
            libraryId: library.id,
            durationMs: Date.now() - startedAt,
          });
          return context;
        } catch (error) {
          await targetDatabase.drainLibraryFileViewSynchronization();
          await targetThumbnails.dispose();
          targetGeneration?.dispose();
          await targetImageDiscovery?.dispose();
          targetDatabase.close();
          throw error;
        }
      };

      const activateLibraryContext = async (context: ActiveLibraryContext) => {
        const previous = appShell.activeLibraryContext;
        appShell.setActiveLibraryContext(context);
        activeLibrary = context.library;
        context.activate();
        if (appShell.mainWindow?.isVisible()) context.startBackgroundServices();
        appShell.updateAppTray();
        if (previous) {
          await previous.dispose().catch((error) => {
            console.error('[local-space] failed to dispose the previous context cleanly', error);
          });
        }
      };

      const initialContext = await createLibraryContext(activeLibrary);
      await activateLibraryContext(initialContext);
      libraryRegistry.updateCurrentName(initialContext.database.getLibraryName());
      activeLibrary = libraryRegistry.get(activeLibrary.id);
      initialContext.library = activeLibrary;

      const assertLibrarySwitchable = () => {
        if (appShell.appUpdateInstallPreparing) {
          throw new Error('Library services are shutting down for an application update');
        }
        if (appShell.libraryTransitionPending) {
          throw new Error('Library transition is already in progress');
        }
        const context = appShell.activeLibraryContext;
        if (!libraryRegistry || !context) throw new Error('Library services are unavailable');
        if (context.state !== 'ACTIVE') throw new Error('Library services are unavailable during a transition');
        if (context.generation.hasPending || context.codex.hasPending) {
          throw new Error('Creation work is in progress');
        }
      };
      const localSpaceDescriptor = (libraryId: string): LocalSpaceDescriptorDto => {
        const descriptor = libraryRegistry?.listSpaces().spaces.find((space) => space.id === libraryId);
        if (!descriptor) throw new Error('Local space is not registered');
        return descriptor;
      };
      const emitLocalSpaceTransition = (
        phase: LocalSpaceTransitionEvent['phase'],
        libraryId: string,
        stage: LocalSpaceTransitionStage,
        progress: number,
      ) => {
        const event: LocalSpaceTransitionEvent = {
          phase,
          stage,
          progress: Math.max(0, Math.min(100, Math.round(progress))),
          space: localSpaceDescriptor(libraryId),
          previews: transitionPreviews.previewsFor(libraryId),
        };
        rendererEvents.send('local-space:transition', event);
        return event.space;
      };
      const transitionTo = async (library: LibraryDescriptor, operation: string) => {
        assertLibrarySwitchable();
        if (!libraryRegistry) throw new Error('Library registry is unavailable');
        if (library.id === activeLibrary.id) return { status: 'cancelled' } as const;
        appShell.libraryTransitionPending = true;
        const previousContext = appShell.activeLibraryContext;
        const previousLibraryId = activeLibrary.id;
        let lastProgress = 5;
        emitLocalSpaceTransition('STARTING', library.id, 'PREPARING', lastProgress);
        let nextContext: ActiveLibraryContext | null = null;
        let registryCommitted = false;
        try {
          if (!previousContext) throw new Error('Library services are unavailable');
          await previousContext.drain();
          await new Promise<void>((resolve) => setImmediate(resolve));
          nextContext = await createLibraryContext(library, (stage, progress) => {
            lastProgress = progress;
            emitLocalSpaceTransition('PROGRESS', library.id, stage, progress);
          });
          lastProgress = 90;
          emitLocalSpaceTransition('PROGRESS', library.id, 'ACTIVATING', lastProgress);
          libraryRegistry.setCurrent(library.id);
          registryCommitted = true;
          libraryRegistry.updateCurrentName(nextContext.database.getLibraryName());
          nextContext.library = libraryRegistry.get(library.id);
          await activateLibraryContext(nextContext);
          nextContext = null;
          const space = emitLocalSpaceTransition('COMPLETED', library.id, 'LOADING_INTERFACE', 95);
          console.info('[local-space] switched in process', { operation, libraryId: library.id });
          return { status: 'switched', space } as const;
        } catch (error) {
          if (nextContext) await nextContext.dispose();
          if (appShell.activeLibraryContext === previousContext) previousContext?.resume();
          if (registryCommitted && activeLibrary.id === previousLibraryId) {
            libraryRegistry.setCurrent(previousLibraryId);
          }
          emitLocalSpaceTransition('FAILED', library.id, 'FAILED', lastProgress);
          throw error;
        } finally {
          appShell.libraryTransitionPending = false;
        }
      };
      const switchTo = (libraryId: string) => {
        if (!libraryRegistry) throw new Error('Library registry is unavailable');
        return transitionTo(libraryRegistry.get(libraryId), 'switch');
      };

      if (!libraryRegistry || !legacySpaceMigration || !localSpaceTransfer) {
        throw new Error('Local-space transfer services are unavailable');
      }
      const legacyMigrationActions = createLegacySpaceMigrationActions({
        appShell,
        registry: libraryRegistry,
        service: legacySpaceMigration,
        assertLibrarySwitchable,
        transitionTo,
        sendProgress: (event) => {
          rendererEvents.send('local-space:migration-progress', event);
        },
      });
      const transferActions = createLocalSpaceTransferActions({
        appShell,
        registry: libraryRegistry,
        service: localSpaceTransfer,
        assertLibrarySwitchable,
        transitionTo,
        sendProgress: (event: LocalSpaceTransferProgressEvent) => {
          rendererEvents.send('local-space:transfer-progress', event);
        },
      });

      const requireActiveContext = () => {
        const context = libraryContextStorage.getStore() ?? appShell.activeLibraryContext;
        if (!context) throw new Error('Library services are unavailable');
        return context;
      };
      const scheduleRatingPreviewRefresh = createTransitionPreviewRatingRefreshScheduler({
        cache: transitionPreviews,
        getContext: requireActiveContext,
        isCurrentContext: (context) =>
          context.state === 'ACTIVE' && appShell.activeLibraryContext?.epoch === context.epoch,
        publish: (spaceId, previews) => rendererEvents.send('app:loading-previews-refreshed', { spaceId, previews }),
      });
      const contextIndependentIpcChannels = new Set([
        'app:request-quit',
        'app:loading-previews',
        'local-spaces:list',
        'local-spaces:discover-legacy',
        'local-spaces:migrate-legacy',
        'local-spaces:cancel-legacy-migration',
        'local-spaces:export-current',
        'local-spaces:import-archive',
        'local-spaces:cancel-transfer',
        'local-spaces:open',
        'local-spaces:switch',
        'local-spaces:create',
        'local-spaces:choose-cover',
        'local-spaces:remove-cover',
        'video-document:transcript-recognition-cancel',
        'video-document:transcript-translation-cancel',
        'video-document:transcript-background-tasks-get',
      ]);
      const runInLibraryContext = (channel: string, invoke: () => unknown) => {
        if (
          appShell.appUpdateInstallPreparing &&
          channel !== 'app:request-quit' &&
          channel !== 'app:loading-previews' &&
          channel !== 'video-document:transcript-recognition-cancel' &&
          channel !== 'video-document:transcript-translation-cancel' &&
          channel !== 'video-document:transcript-background-tasks-get'
        ) {
          throw new Error('Application services are shutting down for an update');
        }
        if (contextIndependentIpcChannels.has(channel)) return invoke();
        const context = requireActiveContext();
        const release = context.acquireOperation();
        return libraryContextStorage.run(context, async () => {
          try {
            return await invoke();
          } finally {
            release();
          }
        });
      };
      registerIpc(
        liveServiceProxy((context) => context.database),
        liveServiceProxy((context) => context.codex),
        liveServiceProxy((context) => context.assistant),
        liveServiceProxy((context) => context.generation),
        liveServiceProxy((context) => context.extensions),
        liveServiceProxy((context) => context.imageDiscovery),
        openAiImageApi,
        deepSeekApi,
        localQwenAsrSidecar,
        transcriptBackgroundTasks,
        assistantRouting,
        externalImageApis,
        generationConcurrency,
        () => {
          const targetDatabase = requireActiveContext().database;
          return installStarterContentPack(targetDatabase, starterContentPackPath);
        },
        [
          path.join(app.getPath('userData'), 'configuration', 'canvas-presets.json'),
          path.join(bundledConfigurationPath, 'canvas-presets.json'),
        ],
        () => appShell.mainWindow,
        (channel, ...args) => rendererEvents.send(channel, ...args),
        appShell.requestAppQuit,
        {
          listSpaces: () => {
            if (!libraryRegistry) throw new Error('Local space registry is unavailable');
            return libraryRegistry.listSpaces();
          },
          discoverLegacy: legacyMigrationActions.discoverLegacy,
          migrateLegacy: legacyMigrationActions.migrateLegacy,
          cancelLegacyMigration: legacyMigrationActions.cancelLegacyMigration,
          currentSpaceName: () => libraryRegistry?.getCurrent().name ?? 'AIY Space',
          exportCurrent: transferActions.exportCurrent,
          importArchive: transferActions.importArchive,
          cancelTransfer: transferActions.cancelTransfer,
          currentCoverUrl: () => {
            if (!libraryRegistry) throw new Error('Local space registry is unavailable');
            return libraryRegistry.getCurrentCoverUrl();
          },
          currentPreviews: () => transitionPreviews.previewsFor(activeLibrary.id),
          refreshCurrentPreviews: scheduleRatingPreviewRefresh,
          open: (rootPath) => {
            if (!libraryRegistry) throw new Error('Library registry is unavailable');
            const registeredIds = new Set(libraryRegistry.list().libraries.map((library) => library.id));
            const candidate = libraryRegistry.registerExisting(rootPath);
            return transitionTo(candidate, 'open').catch((error) => {
              if (!registeredIds.has(candidate.id)) libraryRegistry?.unregisterCandidate(candidate.id);
              throw error;
            });
          },
          switchTo,
          create: async (name) => {
            assertLibrarySwitchable();
            if (!libraryRegistry) throw new Error('Library registry is unavailable');
            const candidate = libraryRegistry.createCandidate(name);
            try {
              return await transitionTo(candidate, 'create');
            } catch (error) {
              libraryRegistry.unregisterCandidate(candidate.id);
              throw error;
            }
          },
          setCover: async (spaceId, sourcePath) => {
            const registry = libraryRegistry;
            if (!registry) throw new Error('Local space registry is unavailable');
            registry.get(spaceId);
            const cover = await prepareLocalSpaceCover(sourcePath);
            return registry.setCover(spaceId, cover);
          },
          removeCover: (spaceId) => {
            if (!libraryRegistry) throw new Error('Local space registry is unavailable');
            return libraryRegistry.removeCover(spaceId);
          },
        },
        runInLibraryContext,
      );
      installRendererProtocol(protocol, path.join(app.getAppPath(), 'out', 'renderer'));
      protocol.handle('aiy-media', async (request) => {
        const url = new URL(request.url);
        const identifier = decodeURIComponent(url.pathname.slice(1));
        const context = CONTEXT_INDEPENDENT_MEDIA_HOSTS.has(url.hostname) ? null : appShell.activeLibraryContext;
        const release = context?.acquireOperation();
        try {
          const assetPath =
            url.hostname === 'asset' || url.hostname === 'asset-thumbnail'
              ? context?.database.getAssetPath(identifier)
              : null;
          let filePath =
            url.hostname === 'space-preview'
              ? transitionPreviews.resolveFile(identifier)
              : url.hostname === 'space-cover'
                ? libraryRegistry?.resolveCoverPath(identifier, url.searchParams.get('revision'))
                : url.hostname === 'asset'
                  ? assetPath
                  : url.hostname === 'video-evidence' && context
                    ? resolveVideoKeyChangeMediaPath(context.database.libraryRoot, identifier)
                    : url.hostname === 'codex-generated' &&
                        context?.extensions.isActivated(CODEX_IMAGE_DISCOVERY_EXTENSION_ID)
                      ? context.imageDiscovery.resolveMediaPath(identifier)
                      : null;
          let thumbnail = false;
          if (url.hostname === 'asset-thumbnail' && context && assetPath) {
            try {
              filePath = await context.thumbnails.get(
                identifier,
                assetPath,
                normalizeMediaThumbnailSize(url.searchParams.get('size')),
              );
              thumbnail = true;
            } catch (error) {
              console.warn('[media-thumbnail] falling back to the original asset', { assetId: identifier, error });
              filePath = assetPath;
            }
          }
          if (!filePath) return new Response('Not found', { status: 404 });

          const response = await fetchLocalFile(filePath, request.headers.get('range'));
          const headers = new Headers(response.headers);
          applyMediaResponseHeaders(headers, url.hostname, filePath, thumbnail);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        } finally {
          release?.();
        }
      });
      installSessionSecurityPolicy(session.defaultSession, appShell.developmentRendererUrl());
      appShell.createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) appShell.createWindow();
      });
    })
    .catch((error) => {
      if (startupFailureReported) return;
      startupFailureReported = true;
      appShell.markQuitRequested();
      const isChinese = app.getLocale().toLowerCase().startsWith('zh');
      const message = error instanceof Error ? error.message : String(error);
      const isModelWorkerFailure = /background model service|model-worker/i.test(message);
      const detail =
        isChinese && message.includes('bundle is missing')
          ? '后台模型服务入口尚未生成。请完整停止当前开发进程，再重新运行一次 npm run dev。'
          : isChinese && message.includes('did not start in time')
            ? '后台模型服务未能及时启动。请完整重启一次开发进程；若仍失败，请查看当前资料库 temp 目录下的 model-worker.error.json。'
            : message;
      const title = isModelWorkerFailure
        ? isChinese
          ? '后台模型服务不可用'
          : 'Background model service unavailable'
        : isChinese
          ? 'AIY 启动失败'
          : 'AIY failed to start';
      console.error('[startup] Application failed to start', error);
      // Automated launches can fail before the harness has a chance to replace
      // native dialogs. Never create a modal-dialog storm in that environment.
      if (process.env.AIY_E2E !== '1') dialog.showErrorBox(title, detail);
      app.quit();
    });
