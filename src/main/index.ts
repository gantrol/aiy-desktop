import { bindNaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import { replayAssetExportCalendar } from '@/main/media/asset-export-calendar';
import { createApplicationMetrics } from '@/main/extensions/metrics/setup';
import { registerExtensionMetricsIpc } from '@/main/ipc/extension-metrics-handlers';
import { app, dialog, safeStorage } from 'electron';
import { CodexContentService } from '@/main/extensions/codex-content/service';
import { libraryTaskLifecycle } from '@/main/libraries/library-task-lifecycle';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { LibraryDatabase } from '@/main/database';
import { ExtensionRegistry } from '@/main/extensions/registry';
import { CodexImageDiscovery } from '@/main/extensions/codex-image-discovery';
import { CodexVisualizationDiscovery } from '@/main/extensions/codex-visualization-discovery';
import { CodexHistorySearch } from '@/main/extensions/codex-history-search';
import { ArticleDeliveryConnections } from '@/main/extensions/article-delivery/connection';
import { ArticleDeliveryJobCoordinator } from '@/main/extensions/article-delivery/job-coordinator';
import { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import { CpaImageConnection } from '@/main/extensions/cpa-image/connection';
import { appendCpaImageRuntimeConfiguration, cpaImageExtensionStatus } from '@/main/extensions/cpa-image/integration';
import { recordImageApiGenerationOutcome } from '@/main/generation/image-api-generation-outcome';
import { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import { LocalQwenAsrSidecarManager } from '@/main/extensions/local-qwen-asr/sidecar-manager';
import { AssistantRoutingConfiguration } from '@/main/assistant/assistant-routing';
import { GenerationConcurrencyConfiguration } from '@/main/generation/concurrency-configuration';
import { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import { createNaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/runtime';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import { registerIpc } from '@/main/ipc/register-ipc';
import { createCompanionLoopback } from '@/main/browser-companion/loopback-runtime';
import { AppUpdateService } from '@/main/app/app-update-service';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import { resolveAiyUserDataPath } from '@/main/app/user-data-path';
import { DesktopApplicationShell } from '@/main/app/application-shell';
import { createDesktopPetalsController } from '@/main/desktop-petals/create-desktop-petals-controller';
import { WorkspaceLayoutStore } from '@/main/app/workspace-layout-store';
import { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import { TransitionPreviewCache, TRANSITION_PREVIEW_LIMIT } from '@/main/app/transition-preview-cache';
import { createTransitionPreviewRatingRefreshScheduler } from '@/main/app/transition-preview-rating-refresh';
import { registerAppUpdateIpc } from '@/main/ipc/app-update-handlers';
import { registerAppDeepLinkIpc } from '@/main/ipc/app-deep-link-handlers';
import { createTrustedIpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { installStarterContentPack } from '@/main/content-packs/starter-pack-installer';
import { MediaThumbnailCache } from '@/main/media/media-thumbnail-cache';
import { VideoDocumentTranscriptBackgroundTaskRegistry } from '@/main/video-transcript/background-task-registry';
import { ImageTransformService } from '@/main/media/image-transform-service';
import { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import { registerApplicationSchemes } from '@/main/app/protocol-schemes';
import { AppDeepLinkController, registerAiyDeepLinkProtocolClient } from '@/main/app/external-deep-link';
import { prepareStartupShell } from '@/main/app/startup-shell';
import { finishStartupStage } from '@/main/app/startup-timing';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { createLibraryStartupTiming } from '@/main/libraries/library-startup-timing';
import { LibraryRegistry, libraryDatabasePath, type LibraryDescriptor } from '@/main/libraries/library-registry';
import { LegacySpaceMigrationService } from '@/main/libraries/legacy-space-migration';
import { createLegacySpaceMigrationActions } from '@/main/libraries/legacy-space-migration-controller';
import { legacyUserDataRoots, localSpaceForbiddenDestinationRoots } from '@/main/libraries/legacy-user-data-roots';
import { prepareLocalSpaceCover } from '@/main/libraries/local-space-cover';
import { LocalSpaceTransferService } from '@/main/libraries/local-space-transfer';
import { createLocalSpaceTransferActions } from '@/main/libraries/local-space-transfer-controller';
import { LibraryContextLifecycle } from '@/main/libraries/library-context-lifecycle';
import { createLibraryIpcRunner } from '@/main/libraries/library-ipc-runner';
import { createLibraryContextRendererEvents } from '@/main/libraries/library-context-renderer-events';
import { BackgroundGenerationClient } from '@/main/model-worker/client';
import type {
  GenerationChangedEvent,
  LocalSpaceDescriptorDto,
  LocalSpaceTransitionEvent,
  LocalSpaceTransitionStage,
  LocalSpaceTransferProgressEvent,
  TransitionPreviewDto,
} from '@/shared/contracts';
import { DEFAULT_PRODUCT_NAME, productNameForLocale } from '@/shared/product';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';

function refreshOpenAiImageApiWorker(generation: BackgroundGenerationClient, connection: OpenAiImageApiConnection) {
  void generation.configureOpenAiImageApi(connection.runtimeConfiguration()).catch((error) => {
    console.error('[openai-image-api] failed to refresh worker verification', error);
  });
}

finishStartupStage('loadMainModule');
registerApplicationSchemes();
const rendererEvents = new RendererEventDispatcher();
const appDeepLinks = new AppDeepLinkController(rendererEvents);
const localQwenAsrSidecar = new LocalQwenAsrSidecarManager();
const transcriptBackgroundTasks = new VideoDocumentTranscriptBackgroundTaskRegistry();
let legacySpaceMigration: LegacySpaceMigrationService | null = null;
let localSpaceTransfer: LocalSpaceTransferService | null = null;
let managedCodexHistorySearch: CodexHistorySearch | null = null;
let desktopPetals: ReturnType<typeof createDesktopPetalsController> | null = null;
const browserCompanionService = createCompanionLoopback(() => appShell.activeLibraryContext, rendererEvents);
const allowWindowPresentation = process.env.AIY_E2E !== '1' || process.env.AIY_E2E_OBSERVE === '1';
const appShell = new DesktopApplicationShell(rendererEvents, {
  backgroundColor: '#f8f7f3',
  title: productNameForLocale(app.getLocale()),
  allowWindowPresentation,
  drainDesktopPetals: () => desktopPetals?.drain() ?? Promise.resolve(true),
  resumeDesktopPetals: () => desktopPetals?.resume(),
  desktopPetals: () => desktopPetals?.tray ?? null,
  onSecondInstanceArguments: (commandLine) => appDeepLinks.acceptCommandLine(commandLine),
  onOpenUrl: (url) => appDeepLinks.acceptUrl(url),
  backgroundModelTasks: transcriptBackgroundTasks,
  stopManagedLocalModels: () => localQwenAsrSidecar.dispose(),
  stopBackgroundFileOperations: () =>
    Promise.all([
      legacySpaceMigration?.dispose() ?? Promise.resolve(),
      localSpaceTransfer?.dispose() ?? Promise.resolve(),
      managedCodexHistorySearch?.dispose() ?? Promise.resolve(),
      browserCompanionService.stop(),
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
const userDataPath = resolveAiyUserDataPath({
  appDataRoot: app.getPath('appData'),
  configuredPath: configuredUserDataPath,
  windowsStore: process.windowsStore,
});
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
if (ownsSingleInstanceLock) appDeepLinks.acceptCommandLine(process.argv);

if (ownsSingleInstanceLock)
  app
    .whenReady()
    .then(async () => {
      finishStartupStage('electronReady');
      desktopPetals = createDesktopPetalsController(appShell, allowWindowPresentation);
      registerAiyDeepLinkProtocolClient();
      const appIpc = createTrustedIpcHandlerRegistrar(() => appShell.mainWindow);
      registerAppDeepLinkIpc(appIpc, appDeepLinks);
      const transitionPreviews = new TransitionPreviewCache(path.join(app.getPath('userData'), 'space-previews'));
      const workspaceLayouts = new WorkspaceLayoutStore(app.getPath('userData'));
      const articleEditorRecovery = new ArticleEditorRecoveryStore(app.getPath('userData'));
      libraryRegistry = new LibraryRegistry(app.getPath('userData'));
      let activeLibrary = libraryRegistry.initialize();
      const startupShell = prepareStartupShell({
        articleEditorRecovery,
        currentSpaceId: () => activeLibrary.id,
        ipcMain: appIpc,
        libraryRegistry: () => libraryRegistry,
        shell: appShell,
        transitionPreviews,
        workspaceLayouts,
      });
      startupShell.createWindow();
      app.on('activate', () => {
        if (!appShell.mainWindow || appShell.mainWindow.isDestroyed()) appShell.createWindow();
      });

      if (process.platform === 'win32') appShell.ensureAppTray();
      await browserCompanionService.startSafely();
      const updates = await new AppUpdateService((state) => {
        rendererEvents.send('app-update:changed', state);
      }).initialize();
      appShell.setAppUpdates(updates);
      registerAppUpdateIpc(appIpc, {
        getState: () => updates.getState(),
        check: () => updates.check(),
        download: () => updates.download(),
        install: () => updates.install(appShell.prepareAppUpdateInstall, appShell.relaunchAfterFailedUpdateInstall),
      });
      const codexHistorySearch = CodexHistorySearch.forApplication(
        app.getPath('userData'),
        () => appShell.activeLibraryContext?.codexContent.repository.historyThreadIds() ?? [],
      );
      codexHistorySearch.on('changed', () => rendererEvents.send('codex-history-search:changed'));
      managedCodexHistorySearch = codexHistorySearch;
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
      const initializeLibrary = (target: LibraryDatabase, library: LibraryDescriptor) =>
        target.initialize(library.name, library, {
          recoverGenerationRuns: false,
          recoverAssistantRuns: false,
          recoverGifRuns: true,
        });
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
      const articleDeliveryConnections = new ArticleDeliveryConnections(
        path.join(connectionDirectory, 'article-delivery'),
        secretProtector,
      );
      const assistantRouting = new AssistantRoutingConfiguration(
        path.join(connectionDirectory, 'assistant-routing.json'),
      );
      const generationConcurrency = new GenerationConcurrencyConfiguration(
        path.join(app.getPath('userData'), 'configuration', 'image-generation-concurrency.json'),
      );
      const externalImageApis = new ExternalImageApiConnections(connectionDirectory, secretProtector);
      const cpaImageApi = new CpaImageConnection(path.join(connectionDirectory, 'cpa-image-api.json'), secretProtector);
      await cpaImageApi.load();
      const configuredWorkerIdleExitMs = Number(process.env.AIY_MODEL_WORKER_IDLE_EXIT_MS);
      const bundledResourcesPath = isPackagedApplication(app) ? process.resourcesPath : app.getAppPath();
      const bundledExtensionsPath = path.join(bundledResourcesPath, 'extensions');
      const naturalWatermarkRuntime = createNaturalWatermarkRuntime(app, bundledExtensionsPath);
      const bundledContentPacksPath = path.join(bundledResourcesPath, 'content-packs');
      const starterContentPackPath = path.join(bundledContentPacksPath, 'creation-starter');
      const bundledConfigurationPath = path.join(bundledResourcesPath, 'configuration');
      const extensionRoots = [
        { rootPath: bundledExtensionsPath, source: 'BUILT_IN' as const },
        { rootPath: path.join(app.getPath('userData'), 'extensions'), source: 'LOCAL' as const },
      ];

      const createLibraryContext = async (
        library: LibraryDescriptor,
        reportProgress?: (stage: LocalSpaceTransitionStage, progress: number) => void,
      ): Promise<ActiveLibraryContext> => {
        const { finishStage, logReady } = createLibraryStartupTiming();
        reportProgress?.('OPENING_DATABASE', 20);
        const createsDatabase = libraryRegistry?.requiresDatabaseCreation(library.id) === true;
        const targetDatabase = new LibraryDatabase(libraryDatabasePath(library), library.rootPath, {
          openMode: createsDatabase ? 'create' : 'must-exist',
        });
        let targetGeneration: BackgroundGenerationClient | null = null;
        const targetImageDiscovery = new CodexImageDiscovery(targetDatabase);
        const targetVisualizationDiscovery = new CodexVisualizationDiscovery();
        const targetThumbnails = new MediaThumbnailCache(library.rootPath);
        const targetImageTransforms = new ImageTransformService(targetDatabase);
        finishStage('openDatabase');
        try {
          const databaseCheck = initializeLibrary(targetDatabase, library);
          if (createsDatabase) libraryRegistry?.markDatabaseCreated(library.id);
          finishStage('initializeDatabase');
          reportProgress?.('CONNECTING_SERVICES', 55);
          targetGeneration = await BackgroundGenerationClient.create({
            databasePath: libraryDatabasePath(library),
            libraryRoot: library.rootPath,
            workerBundlePath: path.join(app.getAppPath(), 'out', 'main', 'model-worker.js'),
            internalModelsEnabled: import.meta.env.DEV,
            cropImage: (input) => targetImageTransforms.crop(input),
            ...(Number.isFinite(configuredWorkerIdleExitMs) && configuredWorkerIdleExitMs >= 1_000
              ? { idleExitMs: configuredWorkerIdleExitMs }
              : {}),
          });
          targetDatabase.setLibraryFileViewBackgroundSynchronizer(() =>
            targetGeneration!.callWorker<void>('library-file-view.refresh', [], 120_000),
          );
          const { codex: targetCodex, assistant: targetAssistant } = targetGeneration;
          finishStage('connectServices');
          reportProgress?.('LOADING_EXTENSIONS', 72);
          const targetExtensions: ExtensionRegistry = await ExtensionRegistry.create(targetDatabase, {
            extensionRoots,
            codexHealth: () => targetCodex.cachedHealth,
            antigravityCliStatus: () => targetGeneration!.antigravityCliStatus,
            codexImageDiscoveryStatus: () => targetImageDiscovery!.status(),
            codexVisualizationDiscoveryStatus: () => targetVisualizationDiscovery!.status(),
            openAiImageApiStatus: () => {
              const status = openAiImageApi.status();
              return {
                configured: status.configured,
                usable: status.status === 'READY' || status.status === 'UNVERIFIED',
                message: status.message,
              };
            },
            cpaImageApiStatus: () => {
              return cpaImageExtensionStatus(cpaImageApi, targetExtensions);
            },
            deepSeekApiStatus: () => {
              const status = deepSeekApi.status();
              return { configured: status.configured, ready: status.status === 'READY', message: status.message };
            },
            articleDeliveryStatus: (extensionId) => articleDeliveryConnections.extensionStatus(extensionId),
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
          const externalImageApiRuntimeConfigurations = () => {
            const configured = externalImageApis.runtimeConfigurations(
              (extensionId, permission) => targetExtensions.isPermissionGranted(extensionId, permission),
              (extensionId) => targetExtensions.isActivated(extensionId),
            );
            return appendCpaImageRuntimeConfiguration(configured, cpaImageApi, targetExtensions);
          };
          const refreshOpenAiImageApiRuntimeConfiguration = () =>
            refreshOpenAiImageApiWorker(targetGeneration!, openAiImageApi);
          finishStage('loadExtensions');
          reportProgress?.('APPLYING_SETTINGS', 82);
          await targetGeneration.configureOpenAiImageApi(openAiImageApi.runtimeConfiguration());
          await targetGeneration.configureDeepSeekApi(deepSeekApi.runtimeConfiguration());
          await targetGeneration.configureExternalImageApis(externalImageApiRuntimeConfigurations());
          await targetGeneration.configureConcurrency(generationConcurrency.get());
          finishStage('applySettings');

          let activated = false;
          let backgroundServicesRequested = false;
          let backgroundServicesStarted = false;
          let backgroundStartTimer: ReturnType<typeof setTimeout> | null = null;
          let discoveryStartTimer: ReturnType<typeof setTimeout> | null = null;
          let unsubscribeCodexPending: (() => void) | null = null;
          let unsubscribeAssistantProgress: (() => void) | null = null;
          const onGenerationChanged = (event: GenerationChangedEvent) => {
            if (event.terminal || !event.runId) targetDatabase.scheduleLibraryFileViewSynchronization();
            if (event.terminal && event.runId) {
              recordImageApiGenerationOutcome(event.runId, {
                database: targetDatabase,
                openAiImageApi,
                cpaImageApi,
                externalImageApis,
                refreshOpenAi: refreshOpenAiImageApiRuntimeConfiguration,
                refreshExternal: () =>
                  targetGeneration!.configureExternalImageApis(externalImageApiRuntimeConfigurations()),
              });
            }
            if (!activated) return;
            rendererEvents.send('generation:changed', event);
            appShell.updateAppTray();
          };
          const contextRendererEvents = createLibraryContextRendererEvents(rendererEvents, () => activated);
          const lifecycle = new LibraryContextLifecycle();
          const targetCodexContent = new CodexContentService(targetDatabase, targetExtensions, targetCodex);
          const targetArticleDeliveryJobs = new ArticleDeliveryJobCoordinator(
            targetDatabase,
            targetExtensions,
            articleDeliveryConnections,
            () => lifecycle.acquireOperation(),
            contextRendererEvents.articleDeliveryJobChanged,
            bindNaturalWatermarkRuntime(naturalWatermarkRuntime, targetExtensions),
          );
          const taskLifecycle = libraryTaskLifecycle(targetCodexContent, targetArticleDeliveryJobs, lifecycle, () => {
            if (backgroundServicesRequested) context.startBackgroundServices();
          });
          const context: ActiveLibraryContext = {
            epoch: ++nextLibraryContextEpoch,
            get state() {
              return lifecycle.state;
            },
            library,
            database: targetDatabase,
            generation: targetGeneration,
            codex: targetCodex,
            ...taskLifecycle,
            assistant: targetAssistant,
            imageDiscovery: targetImageDiscovery,
            visualizationDiscovery: targetVisualizationDiscovery,
            extensions: targetExtensions,
            articleDeliveryJobs: targetArticleDeliveryJobs,
            thumbnails: targetThumbnails,
            acquireOperation() {
              return lifecycle.acquireOperation();
            },
            activate() {
              if (activated) return;
              lifecycle.activate();
              activated = true;
              targetGeneration!.on('changed', onGenerationChanged);
              targetGeneration!.on('worker-status-changed', contextRendererEvents.modelWorkerChanged);
              targetImageDiscovery!.on('changed', contextRendererEvents.codexImagesChanged);
              targetVisualizationDiscovery!.on('changed', contextRendererEvents.codexVisualizationsChanged);
              unsubscribeCodexPending = targetCodex.onPendingChanged(appShell.updateAppTray);
              unsubscribeAssistantProgress = targetAssistant.onProgress((event) => {
                rendererEvents.send('assistant-run:progress', event);
              });
            },
            startBackgroundServices() {
              backgroundServicesRequested = true;
              if (!activated || lifecycle.state !== 'ACTIVE' || backgroundServicesStarted || backgroundStartTimer)
                return;
              backgroundStartTimer = setTimeout(() => {
                backgroundStartTimer = null;
                if (!activated || lifecycle.state !== 'ACTIVE' || backgroundServicesStarted) return;
                backgroundServicesStarted = true;
                try {
                  targetDatabase.startBackgroundStorage();
                  targetArticleDeliveryJobs.start();
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
                        .setActive(targetExtensions.isActivated(CODEX_EXTENSION_ID))
                        .catch((error) => {
                          console.error('[codex-image-discovery] initial scan failed', error);
                        });
                    }, 500);
                  });
              }, 750);
            },
            dispose() {
              activated = false;
              if (backgroundStartTimer) clearTimeout(backgroundStartTimer);
              backgroundStartTimer = null;
              if (discoveryStartTimer) clearTimeout(discoveryStartTimer);
              discoveryStartTimer = null;
              return taskLifecycle.dispose(async () => {
                unsubscribeCodexPending?.();
                unsubscribeAssistantProgress?.();
                unsubscribeCodexPending = null;
                targetGeneration!.off('changed', onGenerationChanged);
                targetGeneration!.off('worker-status-changed', contextRendererEvents.modelWorkerChanged);
                targetImageDiscovery!.off('changed', contextRendererEvents.codexImagesChanged);
                targetVisualizationDiscovery!.off('changed', contextRendererEvents.codexVisualizationsChanged);
                await targetCodexContent.dispose();
                await targetDatabase.drainBackgroundStorage();
                await targetThumbnails.dispose();
                targetGeneration!.dispose();
                await Promise.all([targetImageDiscovery.dispose(), targetVisualizationDiscovery.dispose()]);
                targetDatabase.close();
              });
            },
          };
          finishStage('createContext');
          logReady(library.id, databaseCheck);
          return context;
        } catch (error) {
          await targetDatabase.drainBackgroundStorage();
          await targetThumbnails.dispose();
          targetGeneration?.dispose();
          await Promise.all([targetImageDiscovery.dispose(), targetVisualizationDiscovery.dispose()]);
          targetDatabase.close();
          throw error;
        }
      };

      const activateLibraryContext = async (context: ActiveLibraryContext, restorePetalsAfter?: Promise<void>) => {
        const previous = appShell.activeLibraryContext;
        appShell.setActiveLibraryContext(context);
        activeLibrary = context.library;
        context.activate();
        await replayAssetExportCalendar(context.database);
        await desktopPetals
          ?.activate(context, restorePetalsAfter)
          .catch((error) => console.error('[desktop-petals] restore failed', error));
        codexHistorySearch.setActive(context.extensions.isActivated(CODEX_EXTENSION_ID));
        appShell.requestBackgroundServicesStart(context);
        appShell.updateAppTray();
        if (previous) {
          await previous.dispose().catch((error) => {
            console.error('[local-space] failed to dispose the previous context cleanly', error);
          });
        }
      };

      finishStartupStage('hostSetup');
      const initialContext = await createLibraryContext(activeLibrary);
      finishStartupStage('libraryInit');
      await activateLibraryContext(initialContext, startupShell.afterFirstBootstrap);
      finishStartupStage('contextActivation');
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
          if (!((await desktopPetals?.drain()) ?? true)) throw new Error('便利贴尚未保存，请核对后再切换资料库');
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
          desktopPetals?.resume();
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
      const metricExtensions = liveServiceProxy((context) => context.extensions);
      const applicationMetrics = createApplicationMetrics({
        userDataPath,
        secretProtector,
        extensions: metricExtensions,
        getContext: () => appShell.activeLibraryContext,
      });
      registerExtensionMetricsIpc(appIpc, applicationMetrics.metrics, applicationMetrics.connection, metricExtensions);
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
      const runInLibraryContext = createLibraryIpcRunner({
        updating: () => appShell.appUpdateInstallPreparing,
        independentChannels: contextIndependentIpcChannels,
        context: requireActiveContext,
        storage: libraryContextStorage,
      });
      registerIpc(
        liveServiceProxy((context) => context.database),
        browserCompanionService,
        liveServiceProxy((context) => context.codex),
        liveServiceProxy((context) => context.assistant),
        liveServiceProxy((context) => context.generation),
        liveServiceProxy((context) => context.extensions),
        liveServiceProxy((context) => context.imageDiscovery),
        codexHistorySearch,
        liveServiceProxy((context) => context.visualizationDiscovery),
        articleDeliveryConnections,
        liveServiceProxy((context) => context.articleDeliveryJobs),
        openAiImageApi,
        deepSeekApi,
        localQwenAsrSidecar,
        transcriptBackgroundTasks,
        assistantRouting,
        externalImageApis,
        cpaImageApi,
        generationConcurrency,
        ...naturalWatermarkRuntime,
        () => {
          const targetDatabase = requireActiveContext().database;
          return installStarterContentPack(targetDatabase, starterContentPackPath);
        },
        [
          path.join(app.getPath('userData'), 'configuration', 'canvas-presets.json'),
          path.join(bundledConfigurationPath, 'canvas-presets.json'),
        ],
        [
          path.join(app.getPath('userData'), 'configuration', 'derived-visual-prompts.json'),
          path.join(bundledConfigurationPath, 'derived-visual-prompts.json'),
        ],
        () => appShell.mainWindow,
        (channel, ...args) => rendererEvents.send(channel, ...args),
        appShell.requestAppQuit,
        workspaceLayouts,
        articleEditorRecovery,
        {
          listSpaces: () => {
            if (!libraryRegistry) throw new Error('Local space registry is unavailable');
            return libraryRegistry.listSpaces();
          },
          discoverLegacy: legacyMigrationActions.discoverLegacy,
          migrateLegacy: legacyMigrationActions.migrateLegacy,
          cancelLegacyMigration: legacyMigrationActions.cancelLegacyMigration,
          currentSpaceId: () => {
            if (!libraryRegistry) throw new Error('Local space registry is unavailable');
            return libraryRegistry.getCurrent().id;
          },
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
        startupShell.ipcRuntime(runInLibraryContext),
      );
      finishStartupStage('registerIpc');
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
