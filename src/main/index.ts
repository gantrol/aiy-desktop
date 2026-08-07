import { app, BrowserWindow, dialog, Menu, nativeImage, net, protocol, safeStorage, session, Tray } from 'electron';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CodexService } from '@/main/codex-service';
import type { AssistantService } from '@/main/assistant-service';
import { LibraryDatabase } from '@/main/database';
import { ExtensionRegistry } from '@/main/extensions/registry';
import { CodexImageDiscovery } from '@/main/extensions/codex-image-discovery';
import { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import { AssistantRoutingConfiguration } from '@/main/assistant-routing';
import { ExternalImageApiConnections } from '@/main/extensions/external-image-api';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import { registerIpc } from '@/main/ipc';
import { runDevelopmentCapture } from '@/main/development/capture';
import { installStarterContentPack } from '@/main/content-packs/starter-pack-installer';
import { MediaThumbnailCache, normalizeMediaThumbnailSize } from '@/main/media-thumbnail-cache';
import { ImageTransformService } from '@/main/image-transform-service';
import { RendererEventDispatcher } from '@/main/renderer-event-dispatcher';
import { installRendererProtocol, PACKAGED_RENDERER_URL, RENDERER_SCHEME } from '@/main/renderer-protocol';
import { closeSandboxedImageDecoder } from '@/main/sandboxed-image-decoder';
import { installSessionSecurityPolicy, installWindowNavigationPolicy } from '@/main/window-security';
import { LibraryRegistry, libraryDatabasePath, type LibraryDescriptor } from '@/main/libraries/library-registry';
import { prepareLocalSpaceCover } from '@/main/libraries/local-space-cover';
import { LibraryContextLifecycle, type LibraryContextState } from '@/main/libraries/library-context-lifecycle';
import { BackgroundGenerationClient } from '@/main/model-worker/client';
import type {
  GenerationChangedEvent,
  LocalSpaceDescriptorDto,
  LocalSpaceTransitionEvent,
  LocalSpaceTransitionStage,
  ModelWorkerStatusDto,
} from '@/shared/contracts';
import { DEFAULT_PRODUCT_NAME, productNameForLocale, USER_DATA_DIRECTORY_NAME } from '@/shared/product';
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

let mainWindow: BrowserWindow | null = null;
const rendererEvents = new RendererEventDispatcher();
let generation: BackgroundGenerationClient | null = null;
let libraryRegistry: LibraryRegistry | null = null;
let codexAdapter: CodexService | null = null;
let appTray: Tray | null = null;
let appQuitRequested = false;
let backgroundCompletionNotified = false;
let backgroundCompletionTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundAutoExitTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCloseGuardOpen = false;
let quitAfterBackgroundTasks = false;
let startupFailureReported = false;
let forceQuitRequested = false;
let libraryContextShutdownComplete = false;
let libraryContextShutdownPromise: Promise<void> | null = null;

interface ActiveLibraryContext {
  readonly epoch: number;
  readonly state: LibraryContextState;
  library: LibraryDescriptor;
  database: LibraryDatabase;
  generation: BackgroundGenerationClient;
  codex: CodexService;
  assistant: AssistantService;
  imageDiscovery: CodexImageDiscovery;
  extensions: ExtensionRegistry;
  thumbnails: MediaThumbnailCache;
  acquireOperation(): () => void;
  drain(): Promise<void>;
  resume(): void;
  activate(): void;
  startBackgroundServices(): void;
  dispose(): Promise<void>;
}

let activeLibraryContext: ActiveLibraryContext | null = null;
let nextLibraryContextEpoch = 0;
const libraryContextStorage = new AsyncLocalStorage<ActiveLibraryContext>();

function liveServiceProxy<T extends object>(resolve: (context: ActiveLibraryContext) => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const context = libraryContextStorage.getStore() ?? activeLibraryContext;
      if (!context) throw new Error('Library services are unavailable');
      const service = resolve(context);
      const value = Reflect.get(service, property, service) as unknown;
      return typeof value === 'function' ? value.bind(service) : value;
    },
    set(_target, property, value) {
      const context = libraryContextStorage.getStore() ?? activeLibraryContext;
      if (!context) throw new Error('Library services are unavailable');
      return Reflect.set(resolve(context), property, value);
    },
  });
}

const BACKGROUND_AUTO_EXIT_DELAY_MS = 30_000;

interface HttpByteRange {
  start: number;
  end: number;
}

function parseHttpByteRange(value: string, totalSize: number): HttpByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || totalSize <= 0) return null;

  const [, startValue, endValue] = match;
  if (!startValue && !endValue) return null;
  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, totalSize - suffixLength), end: totalSize - 1 };
  }

  const start = Number(startValue);
  const requestedEnd = endValue ? Number(endValue) : totalSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= totalSize
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, totalSize - 1) };
}

async function fetchLocalFile(filePath: string, requestedRange: string | null): Promise<Response> {
  const totalSize = requestedRange ? statSync(filePath).size : null;
  const byteRange = requestedRange && totalSize !== null ? parseHttpByteRange(requestedRange, totalSize) : null;
  if (requestedRange && (!byteRange || totalSize === null)) {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${totalSize ?? 0}`,
      },
    });
  }

  const response = await net.fetch(pathToFileURL(filePath).toString(), {
    headers: byteRange ? { Range: `bytes=${byteRange.start}-${byteRange.end}` } : undefined,
  });
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (byteRange && totalSize !== null) {
    headers.set('Content-Length', String(byteRange.end - byteRange.start + 1));
    headers.set('Content-Range', `bytes ${byteRange.start}-${byteRange.end}/${totalSize}`);
  }
  return new Response(response.body, {
    status: byteRange ? 206 : response.status,
    statusText: byteRange ? 'Partial Content' : response.statusText,
    headers,
  });
}

const contextIndependentMediaHosts = new Set(['space-preview', 'space-cover']);
const immutableMediaHosts = new Set(['asset', 'asset-thumbnail', 'space-cover']);
const spaceCoverMimeTypeByExtension: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function applyMediaResponseHeaders(headers: Headers, hostname: string, filePath: string, thumbnail: boolean) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (immutableMediaHosts.has(hostname)) headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  const coverMimeType = hostname === 'space-cover' ? spaceCoverMimeTypeByExtension[path.extname(filePath)] : null;
  if (thumbnail) headers.set('Content-Type', 'image/png');
  else if (coverMimeType) headers.set('Content-Type', coverMimeType);
  else if (filePath.endsWith('.mp4') || filePath.endsWith('.m4v')) headers.set('Content-Type', 'video/mp4');
  else if (filePath.endsWith('.webm')) headers.set('Content-Type', 'video/webm');
  else if (filePath.endsWith('.mov')) headers.set('Content-Type', 'video/quicktime');
}

const userDataPath = process.env.AIY_USER_DATA_DIR
  ? path.resolve(process.env.AIY_USER_DATA_DIR)
  : path.resolve(app.getPath('appData'), USER_DATA_DIRECTORY_NAME);
app.setPath('userData', userDataPath);
app.setName(DEFAULT_PRODUCT_NAME);

const ownsSingleInstanceLock = app.requestSingleInstanceLock();
if (!ownsSingleInstanceLock) app.quit();

function showMainWindow() {
  quitAfterBackgroundTasks = false;
  if (backgroundAutoExitTimer) clearTimeout(backgroundAutoExitTimer);
  backgroundAutoExitTimer = null;
  if (backgroundCompletionTimer) clearTimeout(backgroundCompletionTimer);
  backgroundCompletionTimer = null;
  backgroundCompletionNotified = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    updateAppTray();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform !== 'win32') {
    appTray?.destroy();
    appTray = null;
  }
  updateAppTray();
}

function pendingModelTaskCount() {
  return (generation?.tasks.length ?? 0) + (codexAdapter?.pendingCount ?? 0);
}

async function finishUserQuit(cancelTasks: boolean) {
  quitAfterBackgroundTasks = false;
  if (backgroundAutoExitTimer) clearTimeout(backgroundAutoExitTimer);
  backgroundAutoExitTimer = null;
  if (cancelTasks) {
    const cancellations: Promise<unknown>[] = [];
    if (generation) {
      cancellations.push(...generation.tasks.map((task) => generation!.cancel(task.runId)));
    }
    if (codexAdapter) cancellations.push(codexAdapter.cancelAll());
    const results = await Promise.allSettled(cancellations);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  if (generation) {
    if (cancelTasks) await generation.forceShutdown();
    else await generation.shutdown();
  }
  appQuitRequested = true;
  app.quit();
}

async function forceQuitApplication() {
  quitAfterBackgroundTasks = false;
  appQuitRequested = true;
  forceQuitRequested = true;
  if (backgroundCompletionTimer) clearTimeout(backgroundCompletionTimer);
  backgroundCompletionTimer = null;
  if (backgroundAutoExitTimer) clearTimeout(backgroundAutoExitTimer);
  backgroundAutoExitTimer = null;
  try {
    await generation?.forceShutdown();
  } catch (error) {
    // Force quit is an explicit user escape hatch. A stale or unreachable
    // worker must not be allowed to keep the desktop host open.
    console.error('[model-worker] force shutdown failed', error);
  }
  app.exit(0);
}

async function confirmForceQuit(reason?: string) {
  const isChinese = app.getLocale().toLowerCase().startsWith('zh');
  const productName = productNameForLocale(app.getLocale());
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: productName,
    message: isChinese ? '强制退出并中断后台任务？' : 'Force quit and interrupt background tasks?',
    detail: reason
      ? `${reason}\n\n${isChinese ? '强制退出会中断未完成任务，尚未保存的结果可能丢失。' : 'Force quitting interrupts unfinished tasks and may discard results that have not been saved.'}`
      : isChinese
        ? '强制退出会中断未完成任务，尚未保存的结果可能丢失；已经保存的内容不会受影响。'
        : 'Force quitting interrupts unfinished tasks and may discard unsaved results. Saved work is not affected.',
    buttons: isChinese ? ['返回', '强制退出'] : ['Go Back', 'Force Quit'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response !== 1) return false;
  await forceQuitApplication();
  return true;
}

async function guardPendingClose() {
  if (pendingCloseGuardOpen) return;
  const count = pendingModelTaskCount();
  if (count === 0) {
    await finishUserQuit(false);
    return;
  }
  pendingCloseGuardOpen = true;
  const isChinese = app.getLocale().toLowerCase().startsWith('zh');
  const productName = productNameForLocale(app.getLocale());
  try {
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: productName,
      message: isChinese
        ? `仍有 ${count} 个大模型任务正在运行`
        : `${count} model task${count === 1 ? '' : 's'} still running`,
      detail: isChinese
        ? '可以隐藏窗口让任务继续、取消任务后退出，或在二次确认后强制中断。'
        : 'Keep the tasks running in the background, cancel them before quitting, or force an interruption after confirmation.',
      buttons: isChinese
        ? ['继续在后台运行', '取消任务并退出', '强制退出…', '返回']
        : ['Continue in Background', 'Cancel Tasks and Quit', 'Force Quit…', 'Go Back'],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    };
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (response === 0) {
      quitAfterBackgroundTasks = true;
      mainWindow?.hide();
      ensureAppTray();
      updateAppTray();
      return;
    }
    if (response === 1) {
      try {
        await finishUserQuit(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const forced = await confirmForceQuit(
          `${isChinese ? '无法取消后台任务' : 'Unable to cancel background tasks'}: ${message}`,
        );
        if (!forced) showMainWindow();
      }
      return;
    }
    if (response === 2) {
      await confirmForceQuit();
      return;
    }
    showMainWindow();
  } finally {
    pendingCloseGuardOpen = false;
  }
}

async function requestAppQuit() {
  if (appQuitRequested) {
    app.quit();
    return;
  }
  if (pendingModelTaskCount() > 0) {
    await guardPendingClose();
    return;
  }
  try {
    await finishUserQuit(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await confirmForceQuit(`Unable to close the background model service cleanly: ${message}`);
  }
}

function updateAppTrayMenu(count: number, isChinese: boolean) {
  if (!appTray) return;
  const productName = productNameForLocale(isChinese ? 'zh' : 'en');
  const windowReady = Boolean(mainWindow && !mainWindow.isDestroyed());
  const status = !windowReady
    ? isChinese
      ? '正在启动…'
      : 'Starting…'
    : count > 0
      ? isChinese
        ? `后台任务：${count} 个运行中`
        : `Background tasks: ${count} running`
      : quitAfterBackgroundTasks && backgroundCompletionNotified
        ? isChinese
          ? '后台任务：已完成 · 即将退出'
          : 'Background tasks: completed · quitting soon'
        : isChinese
          ? '后台任务：空闲'
          : 'Background tasks: idle';
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: isChinese ? `打开 ${productName}` : `Open ${productName}`,
      enabled: windowReady,
      click: showMainWindow,
    },
    { type: 'separator' },
    { label: status, enabled: false },
    { type: 'separator' },
    {
      label: count > 0 ? (isChinese ? '退出…' : 'Quit…') : isChinese ? '退出' : 'Quit',
      click: () => {
        void requestAppQuit();
      },
    },
    ...(count > 0
      ? [
          {
            label: isChinese ? '强制退出…' : 'Force Quit…',
            click: () => {
              void confirmForceQuit();
            },
          } satisfies Electron.MenuItemConstructorOptions,
        ]
      : []),
  ];
  appTray.setContextMenu(Menu.buildFromTemplate(template));
}

function updateAppTray() {
  if (!appTray) return;
  const count = pendingModelTaskCount();
  const isChinese = app.getLocale().toLowerCase().startsWith('zh');
  const productName = productNameForLocale(app.getLocale());
  appTray.setToolTip(count > 0 ? `${productName} · ${isChinese ? `${count} 个任务` : `${count} tasks`}` : productName);
  updateAppTrayMenu(count, isChinese);
  if (count > 0) {
    if (backgroundCompletionTimer) clearTimeout(backgroundCompletionTimer);
    backgroundCompletionTimer = null;
    if (backgroundAutoExitTimer) clearTimeout(backgroundAutoExitTimer);
    backgroundAutoExitTimer = null;
    backgroundCompletionNotified = false;
    return;
  }
  if (!quitAfterBackgroundTasks || mainWindow?.isVisible()) {
    if (backgroundCompletionTimer) clearTimeout(backgroundCompletionTimer);
    backgroundCompletionTimer = null;
    if (backgroundAutoExitTimer) clearTimeout(backgroundAutoExitTimer);
    backgroundAutoExitTimer = null;
    backgroundCompletionNotified = false;
    return;
  }
  if (backgroundCompletionNotified || backgroundCompletionTimer) return;
  // A generation completion can synchronously trigger a follow-up title task
  // in the renderer. Defer the balloon briefly so that task joins the count.
  backgroundCompletionTimer = setTimeout(() => {
    backgroundCompletionTimer = null;
    if (!appTray) return;
    const remaining = pendingModelTaskCount();
    if (remaining > 0) {
      updateAppTray();
      return;
    }
    backgroundCompletionNotified = true;
    updateAppTrayMenu(0, isChinese);
    if (process.platform === 'win32')
      appTray.displayBalloon({
        title: productName,
        content: isChinese
          ? '后台任务已完成，软件将在 30 秒后退出'
          : 'Background tasks completed. The app will quit in 30 seconds.',
      });
    if (!quitAfterBackgroundTasks || backgroundAutoExitTimer) return;
    backgroundAutoExitTimer = setTimeout(() => {
      backgroundAutoExitTimer = null;
      if (!quitAfterBackgroundTasks || mainWindow?.isVisible()) return;
      if (pendingModelTaskCount() > 0) {
        updateAppTray();
        return;
      }
      void finishUserQuit(false);
    }, BACKGROUND_AUTO_EXIT_DELAY_MS);
  }, 750);
}

function ensureAppTray() {
  if (appTray) return;
  appTray = new Tray(appIcon());
  if (process.platform === 'win32') {
    appTray.on('click', showMainWindow);
    appTray.on('balloon-click', showMainWindow);
  } else {
    appTray.on('double-click', showMainWindow);
  }
  backgroundCompletionNotified = false;
  updateAppTray();
}

app.on('second-instance', () => {
  showMainWindow();
});

function appIcon() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, iconName)]
    : [path.resolve(__dirname, '../../build', iconName), path.join(app.getAppPath(), 'build', iconName)];
  const iconPath = candidates.find((candidate) => existsSync(candidate));
  if (iconPath) return iconPath;
  console.warn('[startup] Application icon is unavailable', { candidates });
  return nativeImage.createEmpty();
}

function developmentRendererUrl() {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL) : null;
}

function createWindow() {
  const expectedRendererUrl = developmentRendererUrl() ?? new URL(PACKAGED_RENDERER_URL);
  const window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f3f1ec',
    title: productNameForLocale(app.getLocale()),
    icon: appIcon(),
    titleBarStyle: 'hidden',
    roundedCorners: true,
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: '#f1efea',
            symbolColor: '#262320',
            height: 36,
          },
        }
      : {}),
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  rendererEvents.attach(window);
  window.on('close', (event) => {
    if (appQuitRequested) return;
    if (process.platform === 'win32') {
      event.preventDefault();
      window.hide();
      ensureAppTray();
      updateAppTray();
      return;
    }
    if (!(generation?.hasPending || codexAdapter?.hasPending)) return;
    event.preventDefault();
    void guardPendingClose();
  });
  if (process.platform === 'win32') {
    window.on('query-session-end', () => {
      appQuitRequested = true;
    });
  }
  window.on('app-command', (event, command) => {
    const navigationCommand =
      command === 'browser-backward' ? 'back' : command === 'browser-forward' ? 'forward' : null;
    if (!navigationCommand) return;
    event.preventDefault();
    rendererEvents.send('app:navigation-command', navigationCommand);
  });
  installWindowNavigationPolicy(window, expectedRendererUrl);
  window.on('closed', () => {
    closeSandboxedImageDecoder();
    if (mainWindow === window) mainWindow = null;
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadURL(PACKAGED_RENDERER_URL);
  }
  window.once('ready-to-show', async () => {
    const restartReadyFile = process.env.AIY_RESTART_READY_FILE;
    if (restartReadyFile) {
      mkdirSync(path.dirname(restartReadyFile), { recursive: true });
      writeFileSync(restartReadyFile, 'ready', 'utf8');
      delete process.env.AIY_RESTART_READY_FILE;
    }
    window.show();
    updateAppTray();
    activeLibraryContext?.startBackgroundServices();
    await runDevelopmentCapture(window);
  });
}

if (ownsSingleInstanceLock)
  app
    .whenReady()
    .then(async () => {
      if (process.platform === 'win32') ensureAppTray();
      const transitionPreviewLimit = 6;
      const transitionPreviewRoot = path.join(app.getPath('userData'), 'space-previews');
      const transitionPreviewManifestVersion = 1;
      const transitionPreviewFiles = new Map<string, string>();
      const transitionPreviewUrls = new Map<string, string[]>();
      const transitionPreviewRefreshes = new Map<string, Promise<void>>();
      type TransitionPreviewSource = {
        path: string;
        size: number;
        mtimeMs: number;
      };
      type TransitionPreviewManifest = {
        version: number;
        sources: TransitionPreviewSource[];
      };
      const transitionPreviewDirectory = (libraryId: string) =>
        path.join(transitionPreviewRoot, Buffer.from(libraryId, 'utf8').toString('base64url'));
      const transitionPreviewManifestPath = (libraryId: string) =>
        path.join(transitionPreviewDirectory(libraryId), 'manifest.json');
      const transitionPreviewToken = (libraryId: string, index: number) =>
        Buffer.from(`${libraryId}\0${index}`, 'utf8').toString('base64url');
      const readTransitionPreviewManifest = (libraryId: string): TransitionPreviewManifest | null => {
        try {
          const value = JSON.parse(
            readFileSync(transitionPreviewManifestPath(libraryId), 'utf8'),
          ) as Partial<TransitionPreviewManifest>;
          if (value.version !== transitionPreviewManifestVersion || !Array.isArray(value.sources)) return null;
          const sources = value.sources.filter((source): source is TransitionPreviewSource =>
            Boolean(
              source &&
              typeof source.path === 'string' &&
              typeof source.size === 'number' &&
              typeof source.mtimeMs === 'number',
            ),
          );
          return sources.length === value.sources.length ? { version: value.version, sources } : null;
        } catch {
          return null;
        }
      };
      const sameTransitionPreviewSource = (left: TransitionPreviewSource | undefined, right: TransitionPreviewSource) =>
        Boolean(left && left.path === right.path && left.size === right.size && left.mtimeMs === right.mtimeMs);
      const registerTransitionPreviews = (libraryId: string, filePaths: string[]) => {
        for (let index = 0; index < transitionPreviewLimit; index += 1) {
          transitionPreviewFiles.delete(transitionPreviewToken(libraryId, index));
        }
        const urls = filePaths.map((filePath, index) => {
          const token = transitionPreviewToken(libraryId, index);
          transitionPreviewFiles.set(token, filePath);
          return `aiy-media://space-preview/${token}`;
        });
        if (urls.length > 0) transitionPreviewUrls.set(libraryId, urls);
        else transitionPreviewUrls.delete(libraryId);
        return urls;
      };
      const loadTransitionPreviewCache = (libraryId: string) => {
        const directory = transitionPreviewDirectory(libraryId);
        const manifest = readTransitionPreviewManifest(libraryId);
        const expectedCount = manifest?.sources.length ?? transitionPreviewLimit;
        const filePaths = Array.from({ length: expectedCount }, (_, index) =>
          path.join(directory, `${index}.jpg`),
        ).filter((filePath) => existsSync(filePath));
        return registerTransitionPreviews(libraryId, filePaths);
      };
      const transitionPreviewsFor = (libraryId: string) => {
        return transitionPreviewUrls.get(libraryId) ?? loadTransitionPreviewCache(libraryId);
      };
      const refreshTransitionPreviewCache = (libraryId: string, sourcePaths: string[]) => {
        const current = transitionPreviewRefreshes.get(libraryId);
        if (current) return current;
        const sources = sourcePaths.slice(0, transitionPreviewLimit).flatMap((sourcePath) => {
          try {
            const stats = statSync(sourcePath);
            if (!stats.isFile()) return [];
            return [{ path: path.resolve(sourcePath), size: stats.size, mtimeMs: stats.mtimeMs }];
          } catch {
            return [];
          }
        });
        const previousManifest = readTransitionPreviewManifest(libraryId);
        const outputPaths = sources.map((_, index) => path.join(transitionPreviewDirectory(libraryId), `${index}.jpg`));
        const cacheIsCurrent =
          previousManifest?.sources.length === sources.length &&
          sources.every(
            (source, index) =>
              sameTransitionPreviewSource(previousManifest.sources[index], source) && existsSync(outputPaths[index]),
          );
        if (cacheIsCurrent) {
          registerTransitionPreviews(libraryId, outputPaths);
          return Promise.resolve();
        }
        if (sources.length === 0) {
          registerTransitionPreviews(libraryId, []);
          return Promise.resolve();
        }
        const directory = transitionPreviewDirectory(libraryId);
        try {
          mkdirSync(directory, { recursive: true });
        } catch (error) {
          console.warn('[local-space] failed to prepare transition preview directory', { libraryId, error });
          return Promise.resolve();
        }
        const refresh = Promise.all(
          sources.map(async (source, index) => {
            const outputPath = outputPaths[index];
            if (sameTransitionPreviewSource(previousManifest?.sources[index], source) && existsSync(outputPath)) {
              return outputPath;
            }
            try {
              const thumbnail = await nativeImage.createThumbnailFromPath(source.path, { width: 216, height: 288 });
              if (thumbnail.isEmpty()) return null;
              writeFileSync(outputPath, thumbnail.toJPEG(72));
              return outputPath;
            } catch (error) {
              console.warn('[local-space] failed to prepare transition preview', {
                libraryId,
                sourcePath: source.path,
                error,
              });
              return null;
            }
          }),
        )
          .then((filePaths) => {
            const complete = filePaths.every((filePath): filePath is string => Boolean(filePath));
            if (complete) {
              try {
                writeFileSync(
                  transitionPreviewManifestPath(libraryId),
                  `${JSON.stringify({ version: transitionPreviewManifestVersion, sources }, null, 2)}\n`,
                  'utf8',
                );
              } catch (error) {
                console.warn('[local-space] failed to persist transition preview manifest', { libraryId, error });
              }
            }
            registerTransitionPreviews(
              libraryId,
              filePaths.filter((filePath): filePath is string => Boolean(filePath)),
            );
          })
          .finally(() => {
            transitionPreviewRefreshes.delete(libraryId);
          });
        transitionPreviewRefreshes.set(libraryId, refresh);
        return refresh;
      };
      libraryRegistry = new LibraryRegistry(app.getPath('userData'));
      let activeLibrary = libraryRegistry.initialize();
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
            updateAppTray();
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
              unsubscribeCodexPending = targetCodex.onPendingChanged(updateAppTray);
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
                let previewRefresh: Promise<void> = Promise.resolve();
                try {
                  const previewSources = targetDatabase
                    .listGallery({
                      locale: 'zh',
                      source: 'ALL',
                      unratedDimensions: [],
                      cursor: null,
                      limit: transitionPreviewLimit,
                    })
                    .items.map((item) => targetDatabase.getAssetPath(item.asset.id))
                    .filter((filePath): filePath is string => Boolean(filePath && existsSync(filePath)));
                  if (previewSources.length > 0) {
                    previewRefresh = refreshTransitionPreviewCache(library.id, previewSources);
                  }
                } catch (error) {
                  console.warn('[local-space] failed to collect transition previews', {
                    libraryId: library.id,
                    error,
                  });
                }
                void previewRefresh.finally(() => {
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
        const previous = activeLibraryContext;
        activeLibraryContext = context;
        activeLibrary = context.library;
        generation = context.generation;
        codexAdapter = context.codex;
        context.activate();
        if (mainWindow?.isVisible()) context.startBackgroundServices();
        updateAppTray();
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

      let libraryTransitionPending = false;
      const assertLibrarySwitchable = () => {
        if (libraryTransitionPending) {
          throw new Error('Library transition is already in progress');
        }
        const context = activeLibraryContext;
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
          previewUrls: transitionPreviewsFor(libraryId),
        };
        rendererEvents.send('local-space:transition', event);
        return event.space;
      };
      const transitionTo = async (library: LibraryDescriptor, operation: string) => {
        assertLibrarySwitchable();
        if (!libraryRegistry) throw new Error('Library registry is unavailable');
        if (library.id === activeLibrary.id) return { status: 'cancelled' } as const;
        libraryTransitionPending = true;
        const previousContext = activeLibraryContext;
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
          if (activeLibraryContext === previousContext) previousContext?.resume();
          if (registryCommitted && activeLibrary.id === previousLibraryId) {
            libraryRegistry.setCurrent(previousLibraryId);
          }
          emitLocalSpaceTransition('FAILED', library.id, 'FAILED', lastProgress);
          throw error;
        } finally {
          libraryTransitionPending = false;
        }
      };
      const switchTo = (libraryId: string) => {
        if (!libraryRegistry) throw new Error('Library registry is unavailable');
        return transitionTo(libraryRegistry.get(libraryId), 'switch');
      };

      const requireActiveContext = () => {
        const context = libraryContextStorage.getStore() ?? activeLibraryContext;
        if (!context) throw new Error('Library services are unavailable');
        return context;
      };
      const contextIndependentIpcChannels = new Set([
        'app:request-quit',
        'local-spaces:list',
        'local-spaces:open',
        'local-spaces:switch',
        'local-spaces:create',
        'local-spaces:choose-cover',
        'local-spaces:remove-cover',
      ]);
      const runInLibraryContext = (channel: string, invoke: () => unknown) => {
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
        assistantRouting,
        externalImageApis,
        () => {
          const targetDatabase = requireActiveContext().database;
          return installStarterContentPack(targetDatabase, starterContentPackPath);
        },
        [
          path.join(app.getPath('userData'), 'configuration', 'canvas-presets.json'),
          path.join(bundledConfigurationPath, 'canvas-presets.json'),
        ],
        () => mainWindow,
        (channel, ...args) => rendererEvents.send(channel, ...args),
        requestAppQuit,
        {
          listSpaces: () => {
            if (!libraryRegistry) throw new Error('Local space registry is unavailable');
            return libraryRegistry.listSpaces();
          },
          currentCoverUrl: () => {
            if (!libraryRegistry) throw new Error('Local space registry is unavailable');
            return libraryRegistry.getCurrentCoverUrl();
          },
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
        const context = contextIndependentMediaHosts.has(url.hostname) ? null : activeLibraryContext;
        const release = context?.acquireOperation();
        try {
          const assetPath =
            url.hostname === 'asset' || url.hostname === 'asset-thumbnail'
              ? context?.database.getAssetPath(identifier)
              : null;
          let filePath =
            url.hostname === 'space-preview'
              ? transitionPreviewFiles.get(identifier)
              : url.hostname === 'space-cover'
                ? libraryRegistry?.resolveCoverPath(identifier, url.searchParams.get('revision'))
                : url.hostname === 'asset'
                  ? assetPath
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
      installSessionSecurityPolicy(session.defaultSession, developmentRendererUrl());
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      if (startupFailureReported) return;
      startupFailureReported = true;
      appQuitRequested = true;
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') void requestAppQuit();
});
app.on('before-quit', (event) => {
  appQuitRequested = true;
  quitAfterBackgroundTasks = false;
  if (backgroundCompletionTimer) clearTimeout(backgroundCompletionTimer);
  backgroundCompletionTimer = null;
  if (backgroundAutoExitTimer) clearTimeout(backgroundAutoExitTimer);
  backgroundAutoExitTimer = null;
  appTray?.destroy();
  appTray = null;
  if (!forceQuitRequested && !libraryContextShutdownComplete && activeLibraryContext) {
    event.preventDefault();
    if (!libraryContextShutdownPromise) {
      const context = activeLibraryContext;
      activeLibraryContext = null;
      generation = null;
      codexAdapter = null;
      libraryContextShutdownPromise = context
        .dispose()
        .catch((error) => {
          console.error('[local-space] failed to close the active context cleanly', error);
        })
        .finally(() => {
          libraryContextShutdownComplete = true;
          app.quit();
        });
    }
    return;
  }
  activeLibraryContext = null;
  generation = null;
  codexAdapter = null;
});
