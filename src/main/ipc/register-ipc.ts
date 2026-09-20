import { bindArticleNoteRecovery } from '@/main/app/article-note-recovery';
import { articleDraftDto } from '@/shared/article-draft';
import { articleWechatMessages } from '@/shared/i18n/article-wechat';
import type { NaturalWatermarkRuntime } from '@/main/extensions/natural-watermark/selection';
import { app, clipboard, dialog, nativeImage, shell, type BrowserWindow } from 'electron';
import { trimTrailingCharacters } from '@/shared/string-boundaries';
import { createHash } from 'node:crypto';
import { chmod, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { registerCalendarIpc } from '@/main/ipc/calendar-handlers';
import { registerContentLibraryIpc } from '@/main/ipc/content-library-handlers';
import { z } from 'zod';
import type {
  ArticleCheckInput,
  Locale,
  VideoDocumentArticleGenerateInput,
  VideoDocumentArticleGenerateResult,
  VideoDocumentTranscriptTranslationResult,
  VideoDocumentTranscriptTranslationWorkerInput,
} from '@/shared/contracts';
import type { ArticleCheckExecutionResult } from '@/shared/contracts/article';
import type { CodexService } from '@/main/assistant/codex-service';
import type { AssistantService } from '@/main/assistant/assistant-service';
import { listImageBreakdownRoutes } from '@/main/assistant-models/image-breakdown-routes';
import { AssetFileActions } from '@/main/media/asset-file-actions';
import { beginAssetExportCalendar } from '@/main/media/asset-export-calendar';
import { ArticleExportService } from '@/main/creations/article-export-service';
import { ArticleWechatCopyService } from '@/main/creations/article-wechat-copy-service';
import { readCanvasPresets } from '@/main/media/canvas-presets';
import { readDerivedVisualPrompts } from '@/main/media/derived-visual-prompts';
import { LibraryDatabase } from '@/main/database';
import { ImageTransformService } from '@/main/media/image-transform-service';
import { copyImageInSandbox } from '@/main/media/image-clipboard-worker-client';
import { rasterizeSvgBytesInSandbox, rasterizeSvgFileInSandbox } from '@/main/media/svg-rasterization';
import type { GenerationService } from '@/main/generation/service';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { CodexImageDiscovery } from '@/main/extensions/codex-image-discovery';
import type { CodexHistorySearch } from '@/main/extensions/codex-history-search';
import type { CodexVisualizationDiscovery } from '@/main/extensions/codex-visualization-discovery';
import { ArticleDeliveryConnections } from '@/main/extensions/article-delivery/connection';
import type { ArticleDeliveryJobCoordinator } from '@/main/extensions/article-delivery/job-coordinator';
import type { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import type { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import type { LocalQwenAsrSidecarManager } from '@/main/extensions/local-qwen-asr/sidecar-manager';
import type { VideoDocumentTranscriptBackgroundTaskRegistry } from '@/main/video-transcript/background-task-registry';
import type { AssistantRoutingConfiguration } from '@/main/assistant/assistant-routing';
import type { GenerationConcurrencyConfiguration } from '@/main/generation/concurrency-configuration';
import type { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import type { CpaImageConnection } from '@/main/extensions/cpa-image/connection';
import type { NaturalWatermarkConfigurationStore } from '@/main/extensions/natural-watermark/configuration';
import type { NaturalWatermarkService } from '@/main/extensions/natural-watermark/service';
import { registerStorageIpc, type LocalSpaceActions } from '@/main/ipc/storage-handlers';
import {
  createTrustedIpcHandlerRegistrar,
  type IpcHandlerRegistrar,
  type TrustedIpcInvocationRunner,
} from '@/main/ipc/trusted-handlers';
import { registerCreatorImportIpc } from '@/main/ipc/creator-import-handlers';
import { registerGifMakingIpc } from '@/main/ipc/gif-making-handlers';
import { registerDictionaryIpc } from '@/main/ipc/dictionary-handlers';
import { registerAssetIpc } from '@/main/ipc/asset-handlers';
import { registerCreationAssistantIpc } from '@/main/ipc/creation-assistant-handlers';
import { registerExtensionSettingsIpc } from '@/main/ipc/extension-settings-handlers';
import { registerGenerationIpc } from '@/main/ipc/generation-handlers';
import { registerIntakeIpc } from '@/main/ipc/intake-handlers';
import { registerLibraryIpc } from '@/main/ipc/library-handlers';
import { registerImageBreakdownIpc } from '@/main/ipc/image-breakdown-handlers';
import { registerVideoDocumentIpc } from '@/main/ipc/video-document-handlers';
import { registerAppSupportIpc } from '@/main/ipc/app-support-handlers';
import { registerRendererDiagnostics } from '@/main/app/renderer-diagnostics';
import { registerAppWindowIpc } from '@/main/ipc/app-window-handlers';
import { registerWorkspaceLayoutIpc } from '@/main/ipc/workspace-layout-handlers';
import type { WorkspaceLayoutStore } from '@/main/app/workspace-layout-store';
import { registerArticleEditorRecoveryIpc } from '@/main/ipc/article-editor-recovery-handlers';
import { registerCreatorInputRecoveryIpc } from '@/main/ipc/creator-input-recovery-handlers';
import { registerSocialPostRecoveryIpc } from '@/main/ipc/social-post-recovery-handlers';
import { registerBackgroundIssueIpc } from '@/main/ipc/background-issue-handlers';
import { registerArticleDeliveryIpc } from '@/main/ipc/article-delivery-handlers';
import type { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import { registerBrowserCompanionIpc } from '@/main/ipc/browser-companion-handlers';
import { BrowserCompanionRuntime } from '@/main/browser-companion/runtime';
import { calendarHandoffLibrary } from '@/main/database/calendar/calendar-handoff-capture';
import { BrowserCompanionBrowserController } from '@/main/browser-companion/browser-controller';
import type { BrowserCompanionLoopbackServer } from '@/main/browser-companion/loopback-server';
import { VideoKeyChangeService } from '@/main/video-documents/key-change-service';
import { VideoDocumentExportService } from '@/main/video-documents/export-service';
import { VideoDocumentAudioProbeService } from '@/main/video-documents/audio-probe-service';
import { creatorAgentAssistSchema, localeSchema, titleSchema } from '@/main/ipc/schemas';
import { NATURAL_WATERMARK_EXTENSION_ID } from '@/shared/extension-ids';

interface VideoDocumentGenerationApi {
  generateVideoDocumentArticle(
    input: VideoDocumentArticleGenerateInput,
    signal?: AbortSignal,
  ): Promise<VideoDocumentArticleGenerateResult>;
  translateVideoDocumentTranscript(
    input: VideoDocumentTranscriptTranslationWorkerInput,
    signal?: AbortSignal,
  ): Promise<VideoDocumentTranscriptTranslationResult>;
}

function safeSpaceArchiveName(name: string) {
  const stem = trimTrailingCharacters(name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' '), '. ')
    .trim()
    .slice(0, 100);
  return `${stem || 'AIY Space'}.aiyspace`;
}

function showDownloadsSaveDialog(getWindow: () => BrowserWindow | null, options: Electron.SaveDialogOptions) {
  const parent = getWindow();
  const defaultPath =
    typeof options.defaultPath === 'string'
      ? path.join(app.getPath('downloads'), path.basename(options.defaultPath))
      : app.getPath('downloads');
  const localizedOptions = { ...options, defaultPath };
  return parent ? dialog.showSaveDialog(parent, localizedOptions) : dialog.showSaveDialog(localizedOptions);
}

async function convertWebpToPng(filePath: string) {
  const image = nativeImage.createFromPath(filePath);
  return image.isEmpty() ? null : image.toPNG();
}

async function convertSvgToPng(filePath: string) {
  try {
    return (await rasterizeSvgFileInSandbox(filePath)).bytes;
  } catch {
    return null;
  }
}

async function convertWebpBytesToPng(bytes: Buffer) {
  const image = nativeImage.createFromBuffer(bytes);
  return image.isEmpty() ? null : image.toPNG();
}

async function convertSvgBytesToPng(bytes: Buffer) {
  try {
    return (await rasterizeSvgBytesInSandbox(bytes)).bytes;
  } catch {
    return null;
  }
}

const compactExecutionWorkbenchOptions = {
  includeExecutionActualRequest: false,
  includeExecutionInputSnapshot: false,
} as const;

function creativeLibraryContainers(database: LibraryDatabase) {
  const articles = database.listArticles();
  return {
    articles,
    creations: database.listCreations(),
    creationItems: database.listCreationItems(),
    animations: database.listAnimationWorks(),
    evaluationSuites: database.listEvaluationSuites(),
    inspirationStashes: articles.filter((article) => article.content.creationInput).map(articleDraftDto),
    imageBreakdowns: database.listImageBreakdowns(),
    socialPosts: database.listSocialPosts(),
    derivedVisuals: database.listDerivedVisuals(),
  };
}

function bootstrapDictionaryProjection(database: LibraryDatabase, locale: Locale) {
  const terms = database.searchCreatorTerms(locale);
  return {
    terms,
    termDetailsIncluded: false as const,
    categories: database.getCategories(locale),
    facets: database.getFacets(locale),
    wordPalettes: database.getWordPalettes(locale, terms),
  };
}

interface BootstrapLoaderOptions {
  canvasPresetPaths: string | readonly string[];
  codex: CodexService;
  database: LibraryDatabase;
  deepSeekApi: DeepSeekApiConnection;
  derivedVisualPromptPaths: string | readonly string[];
  extensions: ExtensionRegistry;
  externalImageApis: ExternalImageApiConnections;
  generation: GenerationService & VideoDocumentGenerationApi;
  localSpaces: LocalSpaceActions;
  workspaceLayouts: WorkspaceLayoutStore;
}

function createBootstrapLoader(options: BootstrapLoaderOptions) {
  return async (rawLocale: unknown) => {
    const locale = localeSchema.parse(rawLocale) as Locale;
    const workbench = options.database.getWorkbench(locale, compactExecutionWorkbenchOptions);
    const spaceId = options.localSpaces.currentSpaceId();
    const workspaceLayout = options.workspaceLayouts.load(spaceId);
    const snapshot = {
      locale,
      spaceId,
      spaceName: options.database.getLibraryName(),
      spaceCoverUrl: options.localSpaces.currentCoverUrl(),
      ...bootstrapDictionaryProjection(options.database, locale),
      canvasPresets: readCanvasPresets(options.canvasPresetPaths, locale),
      derivedVisualPrompts: readDerivedVisualPrompts(options.derivedVisualPromptPaths, locale),
      ...workbench,
      codex: options.codex.cachedHealth,
      extensions: options.extensions.list(),
      modelWorker: options.generation.workerStatus,
      imageGenerationRoutes: options.generation.imageGenerationRoutes,
      imageBreakdownRoutes: listImageBreakdownRoutes(
        options.extensions,
        options.externalImageApis,
        options.deepSeekApi,
        options.generation.antigravityCliStatus,
      ),
      generationTasks: options.generation.tasks,
      assistantRuns: options.database.listAssistantRuns(),
      ...creativeLibraryContainers(options.database),
      styleExplorationBatches: options.database.listStyleExplorationBatches(),
      agentTasks: options.database.listDirectionExperimentDirectorTasks(),
      libraryEmpty: options.database.isLibraryEmpty(),
      creationDraft: options.database.getCreationDraft(),
    };
    return { ...snapshot, workspaceLayout: await workspaceLayout };
  };
}

export function registerApplicationIpc(
  getWindow: () => BrowserWindow | null,
  workspaceLayouts: WorkspaceLayoutStore,
  articleEditorRecovery: ArticleEditorRecoveryStore,
) {
  const ipcMain = createTrustedIpcHandlerRegistrar(getWindow);
  registerRendererDiagnostics(getWindow);
  registerAppSupportIpc(ipcMain);
  registerAppWindowIpc(ipcMain, getWindow);
  registerWorkspaceLayoutIpc(ipcMain, workspaceLayouts);
  registerArticleEditorRecoveryIpc(ipcMain, articleEditorRecovery);
  registerCreatorInputRecoveryIpc(ipcMain, app.getPath('userData'));
  registerSocialPostRecoveryIpc(ipcMain, app.getPath('userData'));
}

export interface RegisterIpcRuntimeOptions {
  ipcMain?: IpcHandlerRegistrar;
  applicationIpcRegistered?: boolean;
  startupChannelsRegistered?: boolean;
  installBootstrapHandler?(handler: (rawLocale: unknown) => unknown): void;
  runInLibraryContext?: TrustedIpcInvocationRunner;
}

function createBrowserCompanionRuntime(
  database: LibraryDatabase,
  service: BrowserCompanionLoopbackServer,
  extensions: ExtensionRegistry,
  naturalWatermarkConfiguration: NaturalWatermarkConfigurationStore,
  naturalWatermarkService: NaturalWatermarkService,
): BrowserCompanionRuntime {
  const browser = new BrowserCompanionBrowserController({
    dataPath: service.dataPath,
    environment: process.env,
    platform: process.platform,
    prepareLaunchUrl: (target, destinationUrl) => service.prepareLaunchUrl(target, destinationUrl),
  });
  void service.handoffs
    .replayCalendarEvents()
    .catch((error) => console.error('[browser-companion] calendar replay pending', error));
  return new BrowserCompanionRuntime(
    service.handoffs,
    browser,
    (assetId) => database.resolveAssetFile(assetId),
    {
      configuration: naturalWatermarkConfiguration,
      service: naturalWatermarkService,
      isActivated: () => extensions.isActivated(NATURAL_WATERMARK_EXTENSION_ID),
    },
    (source) => calendarHandoffLibrary(database.db, source),
  );
}

function showOpenDialog(getWindow: () => BrowserWindow | null, options: Electron.OpenDialogOptions) {
  const parent = getWindow();
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

function createContentIpcServices(
  database: LibraryDatabase,
  getWindow: () => BrowserWindow | null,
  naturalWatermark: NaturalWatermarkRuntime,
  extensions: ExtensionRegistry,
) {
  const videoDocumentExports = new VideoDocumentExportService(database, {
    showSaveDialog: (options) => {
      const parent = getWindow();
      const defaultPath =
        typeof options.defaultPath === 'string'
          ? path.join(app.getPath('downloads'), path.basename(options.defaultPath))
          : undefined;
      const localizedOptions = { ...options, defaultPath };
      return parent ? dialog.showSaveDialog(parent, localizedOptions) : dialog.showSaveDialog(localizedOptions);
    },
    showDirectoryDialog: (options) => {
      const parent = getWindow();
      const defaultPath =
        typeof options.defaultPath === 'string'
          ? path.join(app.getPath('downloads'), path.basename(options.defaultPath))
          : app.getPath('downloads');
      const localizedOptions = { ...options, defaultPath };
      return parent ? dialog.showOpenDialog(parent, localizedOptions) : dialog.showOpenDialog(localizedOptions);
    },
    convertWebpToPng,
    convertSvgToPng,
  });
  return {
    videoKeyChanges: new VideoKeyChangeService(database),
    videoDocumentAudio: new VideoDocumentAudioProbeService(database),
    videoDocumentExports,
    articleExports: new ArticleExportService(database, {
      showSaveDialog: (options) => showDownloadsSaveDialog(getWindow, options),
    }),
    articleWechatCopy: new ArticleWechatCopyService(
      database,
      {
        referenceTitle: (locale) => {
          const messages = extensions.listLanguagePacks().find((pack) => pack.locale === locale)?.messages;
          const copy = messages?.articleWechat;
          if (copy && typeof copy === 'object' && 'referenceTitle' in copy && typeof copy.referenceTitle === 'string') {
            return copy.referenceTitle;
          }
          return articleWechatMessages.referenceTitle;
        },
        writeClipboard: (data) => clipboard.write(data),
        convertWebpBytesToPng,
        convertSvgBytesToPng,
      },
      naturalWatermark,
    ),
  };
}

function createArticleCheckRequestRunner(
  database: LibraryDatabase,
  assistantRouting: AssistantRoutingConfiguration,
  extensions: ExtensionRegistry,
  codex: CodexService,
) {
  return async (request: ArticleCheckInput): Promise<ArticleCheckExecutionResult> => {
    const execution = assistantRouting.resolve('articleCheck');
    if (execution.providerKey !== 'codex' || !execution.reasoningEffort) {
      throw Object.assign(new Error('The configured article check model is not supported'), {
        code: 'ARTICLE_CHECK_PROVIDER_UNSUPPORTED' as const,
      });
    }
    const operationDatabase = Object.freeze({
      startArticleCheck: database.startArticleCheck.bind(database),
      completeArticleCheck: database.completeArticleCheck.bind(database),
      failArticleCheck: database.failArticleCheck.bind(database),
    });
    const checkArticle = codex.checkArticle.bind(codex);
    const run = operationDatabase.startArticleCheck({
      articleId: request.articleId,
      expectedRevisionId: request.expectedRevisionId,
      locale: request.locale,
      providerKey: execution.providerKey,
      requestedModel: execution.modelKey,
      reasoningEffort: execution.reasoningEffort,
    });
    try {
      const extension = extensions.get(execution.extensionId);
      if (!extension?.enabled || extension.connectionState !== 'READY') {
        throw Object.assign(
          new Error(
            `${execution.name} is unavailable: ${extension?.connectionMessage || 'provider extension unavailable'}`,
          ),
          { code: 'ARTICLE_CHECK_PROVIDER_CONFIGURATION_REQUIRED' as const },
        );
      }
      const result = await checkArticle(request, { model: execution.modelKey, effort: execution.reasoningEffort });
      return operationDatabase.completeArticleCheck(run.id, result);
    } catch (reason) {
      try {
        operationDatabase.failArticleCheck(run.id, reason);
      } catch (persistenceError) {
        console.error('[article-check] failed to persist terminal state', {
          runId: run.id,
          diagnostic: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
        });
      }
      throw reason;
    }
  };
}

function registerPublishingIpc(
  ipcMain: ReturnType<typeof createTrustedIpcHandlerRegistrar>,
  database: LibraryDatabase,
  extensions: ExtensionRegistry,
  getWindow: () => BrowserWindow | null,
  browserCompanionService: BrowserCompanionLoopbackServer,
  articleDeliveryConnections: ArticleDeliveryConnections,
  articleDeliveryJobs: ArticleDeliveryJobCoordinator,
  naturalWatermarkConfiguration: NaturalWatermarkConfigurationStore,
  naturalWatermarkService: NaturalWatermarkService,
) {
  registerBrowserCompanionIpc(
    ipcMain,
    createBrowserCompanionRuntime(
      database,
      browserCompanionService,
      extensions,
      naturalWatermarkConfiguration,
      naturalWatermarkService,
    ),
    extensions,
  );
  const naturalWatermark: NaturalWatermarkRuntime = {
    configuration: naturalWatermarkConfiguration,
    service: naturalWatermarkService,
    isActivated: () => extensions.isActivated(NATURAL_WATERMARK_EXTENSION_ID),
  };
  registerArticleDeliveryIpc(
    ipcMain,
    database,
    extensions,
    articleDeliveryConnections,
    articleDeliveryJobs,
    naturalWatermark,
  );
  return createContentIpcServices(database, getWindow, naturalWatermark, extensions);
}

export function registerIpc(
  database: LibraryDatabase,
  browserCompanionService: BrowserCompanionLoopbackServer,
  codex: CodexService,
  assistant: AssistantService,
  generation: GenerationService & VideoDocumentGenerationApi,
  extensions: ExtensionRegistry,
  codexImageDiscovery: CodexImageDiscovery,
  codexHistorySearch: CodexHistorySearch,
  codexVisualizationDiscovery: CodexVisualizationDiscovery,
  articleDeliveryConnections: ArticleDeliveryConnections,
  articleDeliveryJobs: ArticleDeliveryJobCoordinator,
  openAiImageApi: OpenAiImageApiConnection,
  deepSeekApi: DeepSeekApiConnection,
  localQwenAsrSidecar: LocalQwenAsrSidecarManager,
  transcriptBackgroundTasks: VideoDocumentTranscriptBackgroundTaskRegistry,
  assistantRouting: AssistantRoutingConfiguration,
  externalImageApis: ExternalImageApiConnections,
  cpaImageApi: CpaImageConnection,
  generationConcurrency: GenerationConcurrencyConfiguration,
  naturalWatermarkConfiguration: NaturalWatermarkConfigurationStore,
  naturalWatermarkService: NaturalWatermarkService,
  importStarterPack: () => Promise<string>,
  canvasPresetPaths: string | readonly string[],
  derivedVisualPromptPaths: string | readonly string[],
  getWindow: () => BrowserWindow | null,
  sendRendererEvent: (channel: string, ...args: unknown[]) => boolean,
  requestAppQuit: () => Promise<void>,
  workspaceLayouts: WorkspaceLayoutStore,
  articleEditorRecovery: ArticleEditorRecoveryStore,
  localSpaces: LocalSpaceActions,
  runtime: RegisterIpcRuntimeOptions = {},
) {
  if (!runtime.applicationIpcRegistered) registerApplicationIpc(getWindow, workspaceLayouts, articleEditorRecovery);
  bindArticleNoteRecovery(database, articleEditorRecovery, runtime.runInLibraryContext);
  const ipcMain = runtime.ipcMain ?? createTrustedIpcHandlerRegistrar(getWindow, runtime.runInLibraryContext);
  const contentServices = registerPublishingIpc(
    ipcMain,
    database,
    extensions,
    getWindow,
    browserCompanionService,
    articleDeliveryConnections,
    articleDeliveryJobs,
    naturalWatermarkConfiguration,
    naturalWatermarkService,
  );
  const runAssistantRequest = (request: z.infer<typeof creatorAgentAssistSchema>) => {
    const execution = assistantRouting.resolve(request.mode);
    const extension = extensions.get(execution.extensionId);
    if (!extension?.enabled || extension.connectionState !== 'READY') {
      throw new Error(
        `${execution.name} is unavailable: ${extension?.connectionMessage || 'provider extension unavailable'}`,
      );
    }
    const contextHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const capabilityReceipt = {
      directTermCount: request.directTerms.length,
      candidateTermCount: request.candidateTerms.length,
      recipeCount: request.recipes.length,
      referenceCount: request.referenceAssets.length,
      visionAnalyzed: false as const,
    };
    const run = database.startAssistantRun(request, contextHash, capabilityReceipt, {
      providerKey: execution.providerKey,
      modelKey: execution.modelKey,
      reasoningEffort: execution.reasoningEffort,
    });
    for (const progress of run.activityEvents ?? []) {
      sendRendererEvent('assistant-run:progress', progress);
    }
    return assistant.run(run.id);
  };
  const runTitleRequest = (request: z.infer<typeof titleSchema>) => {
    const execution = assistantRouting.resolve('title');
    const extension = extensions.get(execution.extensionId);
    if (!extension?.enabled || extension.connectionState !== 'READY') {
      throw new Error(
        `${execution.name} is unavailable: ${extension?.connectionMessage || 'provider extension unavailable'}`,
      );
    }
    return assistant.suggestTitles(request, {
      providerKey: execution.providerKey,
      modelKey: execution.modelKey,
      reasoningEffort: execution.reasoningEffort,
    });
  };
  const runArticleCheckRequest = createArticleCheckRequestRunner(database, assistantRouting, extensions, codex);

  const chooseFile = (options: Electron.OpenDialogOptions) => showOpenDialog(getWindow, options);
  registerStorageIpc(
    database,
    localSpaces,
    () => chooseFile({ properties: ['openDirectory'] }),
    () => chooseFile({ properties: ['openDirectory'], defaultPath: app.getPath('documents') }),
    (suggestedName) => {
      const parent = getWindow();
      const options: Electron.SaveDialogOptions = {
        defaultPath: path.join(app.getPath('downloads'), safeSpaceArchiveName(suggestedName)),
        filters: [{ name: 'AIY Space', extensions: ['aiyspace'] }],
      };
      return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
    },
    () =>
      chooseFile({
        properties: ['openFile'],
        filters: [{ name: 'AIY Space', extensions: ['aiyspace'] }],
      }),
    () => chooseFile({ properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('documents') }),
    () =>
      chooseFile({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
      }),
    importStarterPack,
    ipcMain,
  );
  registerCreatorImportIpc(
    ipcMain,
    database,
    () =>
      chooseFile({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
      }),
    () => clipboard.readImage(),
  );
  registerDictionaryIpc(
    ipcMain,
    database,
    () =>
      chooseFile({
        properties: ['openFile'],
        filters: [{ name: 'Dictionary', extensions: ['json', 'csv'] }],
      }),
    generation,
  );
  if (!runtime.startupChannelsRegistered) ipcMain.handle('app:request-quit', () => requestAppQuit());
  const assetFiles = new AssetFileActions(
    (assetId) => database.resolveAssetFile(assetId),
    {
      showSaveDialog: (options) => showDownloadsSaveDialog(getWindow, options),
      copyFile: async (sourcePath, destinationPath) => {
        await copyFile(sourcePath, destinationPath);
        // Managed hard links make the immutable source read-only. An explicit
        // export is a user-owned copy and must remain editable.
        await chmod(destinationPath, 0o644);
      },
      copyImage: (filePath) => copyImageInSandbox(filePath),
      showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
      openPath: (filePath) => shell.openPath(filePath),
    },
    async (asset, context) => {
      const revealPath = await database.resolveAssetRevealPathAsync(asset.assetId, context);
      if (!revealPath) throw new Error('Asset file is unavailable');
      return revealPath;
    },
    (assetId) => beginAssetExportCalendar(database, assetId),
  );
  const imageTransforms = new ImageTransformService(database);
  if (!runtime.startupChannelsRegistered) ipcMain.handle('app:loading-previews', () => localSpaces.currentPreviews());
  const loadBootstrap = createBootstrapLoader({
    canvasPresetPaths,
    codex,
    database,
    deepSeekApi,
    derivedVisualPromptPaths,
    extensions,
    externalImageApis,
    generation,
    localSpaces,
    workspaceLayouts,
  });
  if (runtime.installBootstrapHandler) runtime.installBootstrapHandler(loadBootstrap);
  else ipcMain.handle('app:bootstrap', (_event, rawLocale) => loadBootstrap(rawLocale));
  ipcMain.handle('generation:projection', (_event, rawLocale) => {
    const locale = localeSchema.parse(rawLocale) as Locale;
    return {
      ...database.getWorkbench(locale, compactExecutionWorkbenchOptions),
      creationItems: database.listCreationItems(),
      animations: database.listAnimationWorks(),
      styleExplorationBatches: database.listStyleExplorationBatches(),
      agentTasks: database.listDirectionExperimentDirectorTasks(),
    };
  });
  registerExtensionSettingsIpc({
    ipcMain,
    extensions,
    codexImageDiscovery,
    codexHistorySearch,
    codexVisualizationDiscovery,
    openAiImageApi,
    deepSeekApi,
    assistantRouting,
    externalImageApis,
    cpaImageApi,
    generation,
    generationConcurrency,
    naturalWatermarkConfiguration,
    naturalWatermarkService,
    codex,
    chooseFile,
    chooseSaveFile: (options) => showDownloadsSaveDialog(getWindow, options),
    sendRendererEvent,
  });
  registerIntakeIpc(ipcMain, database);
  registerVideoDocumentIpc({
    ipcMain,
    database,
    generation,
    videoKeyChanges: contentServices.videoKeyChanges,
    videoDocumentAudio: contentServices.videoDocumentAudio,
    videoDocumentExports: contentServices.videoDocumentExports,
    localQwenAsrSidecar,
    transcriptBackgroundTasks,
    assistantRouting,
    getWindow,
  });
  registerCreationAssistantIpc({
    ipcMain,
    database,
    codex,
    chooseFile,
    runAssistantRequest,
    runTitleRequest,
    runArticleCheckRequest,
    articleExports: contentServices.articleExports,
    articleWechatCopy: contentServices.articleWechatCopy,
  });
  registerLibraryIpc(ipcMain, database);
  registerContentLibraryIpc(ipcMain, database);
  registerCalendarIpc(ipcMain, database);
  registerImageBreakdownIpc({
    ipcMain,
    database,
    assistant,
    extensions,
    externalImageApis,
    deepSeekApi,
    generation,
  });
  registerBackgroundIssueIpc(ipcMain, database);
  registerGenerationIpc(ipcMain, database, generation, imageTransforms, runAssistantRequest);
  registerAssetIpc(ipcMain, database, assetFiles, localSpaces.refreshCurrentPreviews);
  registerGifMakingIpc(ipcMain, database, generation, codex, assistantRouting);
}
