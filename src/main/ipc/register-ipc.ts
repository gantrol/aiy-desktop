import { app, clipboard, dialog, nativeImage, shell, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { chmod, copyFile } from 'node:fs/promises';
import path from 'node:path';
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
import { registerStorageIpc, type LocalSpaceActions } from '@/main/ipc/storage-handlers';
import { createTrustedIpcHandlerRegistrar, type TrustedIpcInvocationRunner } from '@/main/ipc/trusted-handlers';
import { registerCreatorImportIpc } from '@/main/ipc/creator-import-handlers';
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
import { registerAppWindowIpc } from '@/main/ipc/app-window-handlers';
import { registerWorkspaceLayoutIpc } from '@/main/ipc/workspace-layout-handlers';
import type { WorkspaceLayoutStore } from '@/main/app/workspace-layout-store';
import { registerArticleEditorRecoveryIpc } from '@/main/ipc/article-editor-recovery-handlers';
import { registerBackgroundIssueIpc } from '@/main/ipc/background-issue-handlers';
import { registerArticleDeliveryIpc } from '@/main/ipc/article-delivery-handlers';
import type { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import { registerBrowserCompanionIpc } from '@/main/ipc/browser-companion-handlers';
import { resolveBrowserCompanionDataPath } from '@/main/browser-companion/data-path';
import { BrowserCompanionHandoffStore } from '@/main/browser-companion/handoff-store';
import { BrowserCompanionRuntime } from '@/main/browser-companion/runtime';
import { BrowserCompanionBrowserController } from '@/main/browser-companion/browser-controller';
import { BrowserCompanionNativeHostRegistration } from '@/main/browser-companion/native-host-registration';
import { VideoKeyChangeService } from '@/main/video-documents/key-change-service';
import { VideoDocumentExportService } from '@/main/video-documents/export-service';
import { VideoDocumentAudioProbeService } from '@/main/video-documents/audio-probe-service';
import { creatorAgentAssistSchema, localeSchema, titleSchema } from '@/main/ipc/schemas';

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
  const stem = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
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
  return {
    articles: database.listArticles(),
    creations: database.listCreations(),
    creationItems: database.listCreationItems(),
    evaluationSuites: database.listEvaluationSuites(),
    inspirationStashes: database.listInspirationStashes(),
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

function registerApplicationIpc(
  getWindow: () => BrowserWindow | null,
  workspaceLayouts: WorkspaceLayoutStore,
  articleEditorRecovery: ArticleEditorRecoveryStore,
) {
  const ipcMain = createTrustedIpcHandlerRegistrar(getWindow);
  registerAppSupportIpc(ipcMain);
  registerAppWindowIpc(ipcMain, getWindow);
  registerWorkspaceLayoutIpc(ipcMain, workspaceLayouts);
  registerArticleEditorRecoveryIpc(ipcMain, articleEditorRecovery);
}

function createBrowserCompanionRuntime(database: LibraryDatabase): BrowserCompanionRuntime {
  const dataPath = resolveBrowserCompanionDataPath({
    appDataRoot: app.getPath('appData'),
    configuredUserDataPath: process.env.AIY_USER_DATA_DIR,
  });
  const nativeHost = new BrowserCompanionNativeHostRegistration({
    appPath: app.getAppPath(),
    dataPath,
    environment: process.env,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  });
  const browser = new BrowserCompanionBrowserController({
    dataPath,
    environment: process.env,
    nativeHost,
    platform: process.platform,
  });
  return new BrowserCompanionRuntime(new BrowserCompanionHandoffStore(dataPath), browser, (assetId) =>
    database.resolveAssetFile(assetId),
  );
}

function showOpenDialog(getWindow: () => BrowserWindow | null, options: Electron.OpenDialogOptions) {
  const parent = getWindow();
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

function createContentIpcServices(database: LibraryDatabase, getWindow: () => BrowserWindow | null) {
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
    articleWechatCopy: new ArticleWechatCopyService(database, {
      writeClipboard: (data) => clipboard.write(data),
      convertWebpBytesToPng,
      convertSvgBytesToPng,
    }),
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

export function registerIpc(
  database: LibraryDatabase,
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
  generationConcurrency: GenerationConcurrencyConfiguration,
  importStarterPack: () => Promise<string>,
  canvasPresetPaths: string | readonly string[],
  derivedVisualPromptPaths: string | readonly string[],
  getWindow: () => BrowserWindow | null,
  sendRendererEvent: (channel: string, ...args: unknown[]) => boolean,
  requestAppQuit: () => Promise<void>,
  workspaceLayouts: WorkspaceLayoutStore,
  articleEditorRecovery: ArticleEditorRecoveryStore,
  localSpaces: LocalSpaceActions,
  runInLibraryContext?: TrustedIpcInvocationRunner,
) {
  registerApplicationIpc(getWindow, workspaceLayouts, articleEditorRecovery);
  const ipcMain = createTrustedIpcHandlerRegistrar(getWindow, runInLibraryContext);
  registerBrowserCompanionIpc(ipcMain, createBrowserCompanionRuntime(database), extensions);
  registerArticleDeliveryIpc(ipcMain, database, extensions, articleDeliveryConnections, articleDeliveryJobs);
  const contentServices = createContentIpcServices(database, getWindow);
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
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
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
  ipcMain.handle('app:request-quit', () => requestAppQuit());
  const assetFiles = new AssetFileActions(
    (assetId) => database.resolveAssetFile(assetId),
    {
      showSaveDialog: (options) => {
        const parent = getWindow();
        const defaultPath =
          typeof options.defaultPath === 'string'
            ? path.join(app.getPath('downloads'), path.basename(options.defaultPath))
            : undefined;
        const localizedOptions = { ...options, defaultPath };
        return parent ? dialog.showSaveDialog(parent, localizedOptions) : dialog.showSaveDialog(localizedOptions);
      },
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
  );
  const imageTransforms = new ImageTransformService(database);
  ipcMain.handle('app:loading-previews', () => localSpaces.currentPreviews());
  ipcMain.handle('app:bootstrap', (_event, rawLocale) => {
    const locale = localeSchema.parse(rawLocale) as Locale;
    const workbench = database.getWorkbench(locale, compactExecutionWorkbenchOptions);
    const spaceId = localSpaces.currentSpaceId();
    return {
      locale,
      spaceId,
      spaceName: database.getLibraryName(),
      spaceCoverUrl: localSpaces.currentCoverUrl(),
      workspaceLayout: workspaceLayouts.load(spaceId),
      ...bootstrapDictionaryProjection(database, locale),
      canvasPresets: readCanvasPresets(canvasPresetPaths, locale),
      derivedVisualPrompts: readDerivedVisualPrompts(derivedVisualPromptPaths, locale),
      ...workbench,
      codex: codex.cachedHealth,
      extensions: extensions.list(),
      modelWorker: generation.workerStatus,
      imageGenerationRoutes: generation.imageGenerationRoutes,
      imageBreakdownRoutes: listImageBreakdownRoutes(
        extensions,
        externalImageApis,
        deepSeekApi,
        generation.antigravityCliStatus,
      ),
      generationTasks: generation.tasks,
      assistantRuns: database.listAssistantRuns(),
      ...creativeLibraryContainers(database),
      styleExplorationBatches: database.listStyleExplorationBatches(),
      agentTasks: database.listDirectionExperimentDirectorTasks(),
      libraryEmpty: database.isLibraryEmpty(),
      creationDraft: database.getCreationDraft(),
    };
  });
  ipcMain.handle('generation:projection', (_event, rawLocale) => {
    const locale = localeSchema.parse(rawLocale) as Locale;
    return {
      ...database.getWorkbench(locale, compactExecutionWorkbenchOptions),
      creationItems: database.listCreationItems(),
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
    generation,
    generationConcurrency,
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
}
