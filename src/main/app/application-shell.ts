import { app, BrowserWindow, dialog, Menu, nativeImage, screen, Tray, type Rectangle } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CodexService } from '@/main/assistant/codex-service';
import { AppUpdateService } from '@/main/app/app-update-service';
import { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import { PACKAGED_RENDERER_URL } from '@/main/app/renderer-protocol';
import { installWindowNavigationPolicy } from '@/main/app/window-security';
import { runDevelopmentCapture } from '@/main/development/capture';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { closeSandboxedImageDecoder } from '@/main/media/sandboxed-image-decoder';
import type { BackgroundGenerationClient } from '@/main/model-worker/client';
import { productNameForLocale } from '@/shared/product';
import { appWindowStateSchema } from '@/shared/contracts/app-window';
import { WindowStateStore } from '@/main/app/window-state-store';

const DEFAULT_WINDOW_WIDTH = 1_500;
const DEFAULT_WINDOW_HEIGHT = 920;
const MINIMUM_WINDOW_WIDTH = 1_100;
const MINIMUM_WINDOW_HEIGHT = 720;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function restoreWindowBounds(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const width = Math.min(Math.max(bounds.width, MINIMUM_WINDOW_WIDTH), workArea.width);
  const height = Math.min(Math.max(bounds.height, MINIMUM_WINDOW_HEIGHT), workArea.height);
  return {
    x: clamp(bounds.x, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - width)),
    y: clamp(bounds.y, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}

interface DesktopApplicationShellOptions {
  backgroundColor: string;
  title: string;
  allowWindowPresentation: boolean;
  onSecondInstanceArguments?(commandLine: string[]): void;
  onOpenUrl?(url: string): void;
  backgroundModelTasks?: {
    readonly activeCount: number;
    cancelAll(): Promise<void>;
    abortAll(): void;
  };
  stopManagedLocalModels?(): Promise<void>;
  stopBackgroundFileOperations?(): Promise<void>;
}

export class DesktopApplicationShell {
  mainWindow: BrowserWindow | null = null;

  private backgroundServicesStartDeferred = false;

  private generation: BackgroundGenerationClient | null = null;

  private codexAdapter: CodexService | null = null;

  private appTray: Tray | null = null;

  private appQuitRequested = false;

  private backgroundCompletionNotified = false;

  private backgroundCompletionTimer: ReturnType<typeof setTimeout> | null = null;

  private backgroundAutoExitTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingCloseGuardOpen = false;

  private quitAfterBackgroundTasks = false;

  private forceQuitRequested = false;

  private libraryContextShutdownComplete = false;

  private libraryContextShutdownPromise: Promise<void> | null = null;

  private applicationShutdownPromise: Promise<void> | null = null;

  private appUpdates: AppUpdateService | null = null;

  appUpdateInstallPreparing = false;

  private appUpdateRecoveryRequested = false;

  libraryTransitionPending = false;

  activeLibraryContext: ActiveLibraryContext | null = null;

  private readonly BACKGROUND_AUTO_EXIT_DELAY_MS = 30_000;

  private readonly showMainWindow = () => {
    if (!this.options.allowWindowPresentation) return;
    this.quitAfterBackgroundTasks = false;
    if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
    this.backgroundAutoExitTimer = null;
    if (this.backgroundCompletionTimer) clearTimeout(this.backgroundCompletionTimer);
    this.backgroundCompletionTimer = null;
    this.backgroundCompletionNotified = false;
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.updateAppTray();
      return;
    }
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.show();
    this.mainWindow.focus();
    if (process.platform !== 'win32') {
      this.appTray?.destroy();
      this.appTray = null;
    }
    this.updateAppTray();
  };

  private readonly pendingModelTaskCount = () => {
    return (
      (this.generation?.tasks.length ?? 0) +
      (this.codexAdapter?.pendingCount ?? 0) +
      (this.options.backgroundModelTasks?.activeCount ?? 0)
    );
  };

  private readonly stopModelServices = async (cancelTasks: boolean) => {
    const targetGeneration = this.generation;
    const targetCodex = this.codexAdapter;
    if (cancelTasks) {
      const cancellations: Promise<unknown>[] = [];
      if (targetGeneration) {
        cancellations.push(...targetGeneration.tasks.map((task) => targetGeneration.cancel(task.runId)));
      }
      if (targetCodex) cancellations.push(targetCodex.cancelAll());
      if (this.options.backgroundModelTasks?.activeCount) {
        cancellations.push(this.options.backgroundModelTasks.cancelAll());
      }
      const results = await Promise.allSettled(cancellations);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
    if (targetGeneration) {
      if (cancelTasks) await targetGeneration.forceShutdown();
      else await targetGeneration.shutdown();
    }
  };

  private readonly shutdownActiveLibraryContext = () => {
    if (this.libraryContextShutdownComplete) return Promise.resolve();
    if (this.libraryContextShutdownPromise) return this.libraryContextShutdownPromise;
    const context = this.activeLibraryContext;
    this.activeLibraryContext = null;
    this.generation = null;
    this.codexAdapter = null;
    if (!context) {
      this.libraryContextShutdownComplete = true;
      return Promise.resolve();
    }
    this.libraryContextShutdownPromise = context.dispose().finally(() => {
      this.libraryContextShutdownComplete = true;
    });
    return this.libraryContextShutdownPromise;
  };

  private readonly shutdownApplicationServices = () => {
    if (this.applicationShutdownPromise) return this.applicationShutdownPromise;
    this.applicationShutdownPromise = Promise.all([
      this.options.stopManagedLocalModels?.() ?? Promise.resolve(),
      this.options.stopBackgroundFileOperations?.() ?? Promise.resolve(),
      this.shutdownActiveLibraryContext(),
    ]).then(() => undefined);
    return this.applicationShutdownPromise;
  };

  private readonly finishUserQuit = async (cancelTasks: boolean) => {
    this.quitAfterBackgroundTasks = false;
    if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
    this.backgroundAutoExitTimer = null;
    await this.stopModelServices(cancelTasks);
    await this.options.stopManagedLocalModels?.();
    this.appQuitRequested = true;
    app.quit();
  };

  readonly prepareAppUpdateInstall = async () => {
    if (this.pendingCloseGuardOpen || this.appUpdateInstallPreparing || this.libraryTransitionPending) return false;
    this.appUpdateInstallPreparing = true;
    let prepared = false;
    try {
      const count = this.pendingModelTaskCount();
      if (count > 0) {
        this.pendingCloseGuardOpen = true;
        const isChinese = app.getLocale().toLowerCase().startsWith('zh');
        const options: Electron.MessageBoxOptions = {
          type: 'warning',
          title: productNameForLocale(app.getLocale()),
          message: isChinese
            ? `安装更新前需要停止 ${count} 个正在运行的大模型任务`
            : `${count} running model task${count === 1 ? '' : 's'} must stop before updating`,
          detail: isChinese
            ? '取消任务后，应用会安全关闭当前资料库并安装已经下载的更新。'
            : 'After cancelling the tasks, the app will close the current local space safely and install the downloaded update.',
          buttons: isChinese ? ['取消任务并更新', '暂不更新'] : ['Cancel Tasks and Update', 'Not Now'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        };
        try {
          const parent =
            this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible() ? this.mainWindow : null;
          const { response } = parent
            ? await dialog.showMessageBox(parent, options)
            : await dialog.showMessageBox(options);
          if (response !== 0) return false;
        } finally {
          this.pendingCloseGuardOpen = false;
        }
      }

      this.quitAfterBackgroundTasks = false;
      if (this.backgroundCompletionTimer) clearTimeout(this.backgroundCompletionTimer);
      this.backgroundCompletionTimer = null;
      if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
      this.backgroundAutoExitTimer = null;
      try {
        await this.stopModelServices(count > 0);
        await this.options.stopManagedLocalModels?.();
        await this.shutdownActiveLibraryContext();
      } catch (error) {
        this.relaunchAfterFailedUpdateInstall();
        throw error;
      }
      this.appQuitRequested = true;
      prepared = true;
      return true;
    } finally {
      if (!prepared) this.appUpdateInstallPreparing = false;
    }
  };

  readonly relaunchAfterFailedUpdateInstall = () => {
    if (this.appUpdateRecoveryRequested) return;
    this.appUpdateRecoveryRequested = true;
    this.appUpdateInstallPreparing = false;
    console.warn('[app-update] relaunching the current version after an update installation failure');
    try {
      app.relaunch();
    } catch (error) {
      console.error('[app-update] failed to schedule the current version for relaunch', error);
    }
    if (this.activeLibraryContext && !this.libraryContextShutdownComplete) {
      this.appQuitRequested = true;
      app.quit();
      return;
    }
    app.exit(0);
  };

  private readonly forceQuitApplication = async () => {
    this.quitAfterBackgroundTasks = false;
    this.appQuitRequested = true;
    this.forceQuitRequested = true;
    if (this.backgroundCompletionTimer) clearTimeout(this.backgroundCompletionTimer);
    this.backgroundCompletionTimer = null;
    if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
    this.backgroundAutoExitTimer = null;
    this.options.backgroundModelTasks?.abortAll();
    try {
      await this.generation?.forceShutdown();
    } catch (error) {
      // Force quit is an explicit user escape hatch. A stale or unreachable
      // worker must not be allowed to keep the desktop host open.
      console.error('[model-worker] force shutdown failed', error);
    }
    await this.options.stopManagedLocalModels?.().catch((error) => {
      console.error('[local-model] force shutdown failed', error);
    });
    await this.options.stopBackgroundFileOperations?.().catch((error) => {
      console.error('[background-files] force shutdown failed', error);
    });
    app.exit(0);
  };

  private readonly confirmForceQuit = async (reason?: string) => {
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
    const parent =
      this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible() ? this.mainWindow : null;
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (response !== 1) return false;
    await this.forceQuitApplication();
    return true;
  };

  private readonly guardPendingClose = async () => {
    if (this.pendingCloseGuardOpen) return;
    const count = this.pendingModelTaskCount();
    if (count === 0) {
      await this.finishUserQuit(false);
      return;
    }
    this.pendingCloseGuardOpen = true;
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
      const parent =
        this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible() ? this.mainWindow : null;
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (response === 0) {
        this.quitAfterBackgroundTasks = true;
        this.mainWindow?.hide();
        this.ensureAppTray();
        this.updateAppTray();
        return;
      }
      if (response === 1) {
        try {
          await this.finishUserQuit(true);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const forced = await this.confirmForceQuit(
            `${isChinese ? '无法取消后台任务' : 'Unable to cancel background tasks'}: ${message}`,
          );
          if (!forced) this.showMainWindow();
        }
        return;
      }
      if (response === 2) {
        await this.confirmForceQuit();
        return;
      }
      this.showMainWindow();
    } finally {
      this.pendingCloseGuardOpen = false;
    }
  };

  readonly requestAppQuit = async () => {
    if (this.appUpdateInstallPreparing) return;
    if (this.appQuitRequested) {
      app.quit();
      return;
    }
    if (this.pendingModelTaskCount() > 0) {
      await this.guardPendingClose();
      return;
    }
    try {
      await this.finishUserQuit(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.confirmForceQuit(`Unable to close the background model service cleanly: ${message}`);
    }
  };

  private readonly updateAppTrayMenu = (count: number, isChinese: boolean) => {
    if (!this.appTray) return;
    const productName = productNameForLocale(isChinese ? 'zh' : 'en');
    const windowReady = Boolean(this.mainWindow && !this.mainWindow.isDestroyed());
    const status = !windowReady
      ? isChinese
        ? '正在启动…'
        : 'Starting…'
      : count > 0
        ? isChinese
          ? `后台任务：${count} 个运行中`
          : `Background tasks: ${count} running`
        : this.quitAfterBackgroundTasks && this.backgroundCompletionNotified
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
        click: this.showMainWindow,
      },
      { type: 'separator' },
      { label: status, enabled: false },
      { type: 'separator' },
      {
        label: count > 0 ? (isChinese ? '退出…' : 'Quit…') : isChinese ? '退出' : 'Quit',
        click: () => {
          void this.requestAppQuit();
        },
      },
      ...(count > 0
        ? [
            {
              label: isChinese ? '强制退出…' : 'Force Quit…',
              click: () => {
                void this.confirmForceQuit();
              },
            } satisfies Electron.MenuItemConstructorOptions,
          ]
        : []),
    ];
    this.appTray.setContextMenu(Menu.buildFromTemplate(template));
  };

  readonly updateAppTray = () => {
    if (!this.appTray) return;
    const count = this.pendingModelTaskCount();
    const isChinese = app.getLocale().toLowerCase().startsWith('zh');
    const productName = productNameForLocale(app.getLocale());
    this.appTray.setToolTip(
      count > 0 ? `${productName} · ${isChinese ? `${count} 个任务` : `${count} tasks`}` : productName,
    );
    this.updateAppTrayMenu(count, isChinese);
    if (count > 0) {
      if (this.backgroundCompletionTimer) clearTimeout(this.backgroundCompletionTimer);
      this.backgroundCompletionTimer = null;
      if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
      this.backgroundAutoExitTimer = null;
      this.backgroundCompletionNotified = false;
      return;
    }
    if (!this.quitAfterBackgroundTasks || this.mainWindow?.isVisible()) {
      if (this.backgroundCompletionTimer) clearTimeout(this.backgroundCompletionTimer);
      this.backgroundCompletionTimer = null;
      if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
      this.backgroundAutoExitTimer = null;
      this.backgroundCompletionNotified = false;
      return;
    }
    if (this.backgroundCompletionNotified || this.backgroundCompletionTimer) return;
    // A generation completion can synchronously trigger a follow-up title task
    // in the renderer. Defer the balloon briefly so that task joins the count.
    this.backgroundCompletionTimer = setTimeout(() => {
      this.backgroundCompletionTimer = null;
      if (!this.appTray) return;
      const remaining = this.pendingModelTaskCount();
      if (remaining > 0) {
        this.updateAppTray();
        return;
      }
      this.backgroundCompletionNotified = true;
      this.updateAppTrayMenu(0, isChinese);
      if (process.platform === 'win32')
        this.appTray.displayBalloon({
          title: productName,
          content: isChinese
            ? '后台任务已完成，软件将在 30 秒后退出'
            : 'Background tasks completed. The app will quit in 30 seconds.',
        });
      if (!this.quitAfterBackgroundTasks || this.backgroundAutoExitTimer) return;
      this.backgroundAutoExitTimer = setTimeout(() => {
        this.backgroundAutoExitTimer = null;
        if (!this.quitAfterBackgroundTasks || this.mainWindow?.isVisible()) return;
        if (this.pendingModelTaskCount() > 0) {
          this.updateAppTray();
          return;
        }
        void this.finishUserQuit(false);
      }, this.BACKGROUND_AUTO_EXIT_DELAY_MS);
    }, 750);
  };

  readonly ensureAppTray = () => {
    if (this.appTray) return;
    this.appTray = new Tray(this.appIcon());
    if (process.platform === 'win32') {
      this.appTray.on('click', this.showMainWindow);
      this.appTray.on('balloon-click', this.showMainWindow);
    } else {
      this.appTray.on('double-click', this.showMainWindow);
    }
    this.backgroundCompletionNotified = false;
    this.updateAppTray();
  };

  private readonly appIcon = () => {
    const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, iconName)]
      : [path.resolve(__dirname, '../../build', iconName), path.join(app.getAppPath(), 'build', iconName)];
    const iconPath = candidates.find((candidate) => existsSync(candidate));
    if (iconPath) return iconPath;
    console.warn('[startup] Application icon is unavailable', { candidates });
    return nativeImage.createEmpty();
  };

  readonly developmentRendererUrl = () => {
    return !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL) : null;
  };

  readonly createWindow = () => {
    const expectedRendererUrl = this.developmentRendererUrl() ?? new URL(PACKAGED_RENDERER_URL);
    const windowStateStore = new WindowStateStore(app.getPath('userData'));
    const restoredWindowState = windowStateStore.load();
    const restoredBounds = restoredWindowState ? restoreWindowBounds(restoredWindowState.normalBounds) : null;
    const window = new BrowserWindow({
      ...(restoredBounds ?? { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }),
      minWidth: MINIMUM_WINDOW_WIDTH,
      minHeight: MINIMUM_WINDOW_HEIGHT,
      backgroundColor: this.options.backgroundColor,
      title: this.options.title,
      icon: this.appIcon(),
      titleBarStyle: 'hidden',
      roundedCorners: true,
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'out', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.mainWindow = window;
    this.rendererEvents.attach(window);
    let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const saveWindowState = () => {
      if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
      if (window.isDestroyed() || window.isMinimized()) return;
      try {
        windowStateStore.save({
          schemaVersion: 1,
          normalBounds: window.getNormalBounds(),
          maximized: window.isMaximized(),
        });
      } catch (error) {
        console.error('[window-state] Failed to persist window state', error);
      }
    };
    const scheduleWindowStateSave = () => {
      if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = setTimeout(saveWindowState, 250);
    };
    const sendWindowState = () =>
      this.rendererEvents.send(
        'app-window:state-changed',
        appWindowStateSchema.parse({ maximized: window.isMaximized() }),
      );
    window.on('move', scheduleWindowStateSave);
    window.on('resize', scheduleWindowStateSave);
    window.on('maximize', () => {
      sendWindowState();
      scheduleWindowStateSave();
    });
    window.on('unmaximize', () => {
      sendWindowState();
      scheduleWindowStateSave();
    });
    window.on('close', (event) => {
      saveWindowState();
      if (this.appQuitRequested) return;
      if (this.appUpdateInstallPreparing) {
        event.preventDefault();
        return;
      }
      if (process.platform === 'win32') {
        event.preventDefault();
        window.hide();
        this.ensureAppTray();
        this.updateAppTray();
        return;
      }
      if (!(this.generation?.hasPending || this.codexAdapter?.hasPending)) return;
      event.preventDefault();
      void this.guardPendingClose();
    });
    if (process.platform === 'win32') {
      window.on('query-session-end', () => {
        // Never delay Windows shutdown or sign-out with user-close or update prompts.
        this.appQuitRequested = true;
      });
    }
    window.on('app-command', (event, command) => {
      const navigationCommand =
        command === 'browser-backward' ? 'back' : command === 'browser-forward' ? 'forward' : null;
      if (!navigationCommand) return;
      event.preventDefault();
      this.rendererEvents.send('app:navigation-command', navigationCommand);
    });
    installWindowNavigationPolicy(window, expectedRendererUrl);
    window.on('closed', () => {
      if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
      closeSandboxedImageDecoder();
      if (this.mainWindow === window) this.mainWindow = null;
    });
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void window.loadURL(PACKAGED_RENDERER_URL);
    }
    if (restoredWindowState?.maximized) window.maximize();
    window.once('ready-to-show', async () => {
      const restartReadyFile = process.env.AIY_RESTART_READY_FILE;
      if (restartReadyFile) {
        mkdirSync(path.dirname(restartReadyFile), { recursive: true });
        writeFileSync(restartReadyFile, 'ready', 'utf8');
        delete process.env.AIY_RESTART_READY_FILE;
      }
      if (this.options.allowWindowPresentation) window.show();
      this.updateAppTray();
      this.requestBackgroundServicesStart();
      this.appUpdates?.startAutomaticChecks();
      await runDevelopmentCapture(window);
    });
  };

  constructor(
    private readonly rendererEvents: RendererEventDispatcher,
    private readonly options: DesktopApplicationShellOptions,
  ) {
    app.on('second-instance', (_event, commandLine) => {
      this.options.onSecondInstanceArguments?.(commandLine);
      this.showMainWindow();
    });

    app.on('open-url', (event, url) => {
      event.preventDefault();
      this.options.onOpenUrl?.(url);
      this.showMainWindow();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') void this.requestAppQuit();
    });

    app.on('before-quit', (event) => {
      this.appQuitRequested = true;
      this.quitAfterBackgroundTasks = false;
      if (this.backgroundCompletionTimer) clearTimeout(this.backgroundCompletionTimer);
      this.backgroundCompletionTimer = null;
      if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
      this.backgroundAutoExitTimer = null;
      this.appTray?.destroy();
      this.appTray = null;
      this.appUpdates?.dispose();
      this.appUpdates = null;
      if (!this.forceQuitRequested && !this.libraryContextShutdownComplete && this.activeLibraryContext) {
        event.preventDefault();
        if (!this.applicationShutdownPromise) {
          this.shutdownApplicationServices()
            .catch((error) => {
              console.error('[shutdown] failed to close application services cleanly', error);
            })
            .finally(() => {
              this.libraryContextShutdownComplete = true;
              app.quit();
            });
        }
        return;
      }
      this.activeLibraryContext = null;
      this.generation = null;
      this.codexAdapter = null;
    });
  }

  setActiveLibraryContext(context: ActiveLibraryContext) {
    this.activeLibraryContext = context;
    this.generation = context.generation;
    this.codexAdapter = context.codex;
    this.libraryContextShutdownComplete = false;
    this.libraryContextShutdownPromise = null;
    this.applicationShutdownPromise = null;
  }

  deferBackgroundServicesStart() {
    this.backgroundServicesStartDeferred = true;
  }

  resumeBackgroundServicesStart() {
    this.backgroundServicesStartDeferred = false;
    this.requestBackgroundServicesStart();
  }

  requestBackgroundServicesStart(context = this.activeLibraryContext) {
    if (this.backgroundServicesStartDeferred || !this.mainWindow?.isVisible()) return;
    context?.startBackgroundServices();
  }

  setAppUpdates(updates: AppUpdateService) {
    this.appUpdates = updates;
  }

  markQuitRequested() {
    this.appQuitRequested = true;
  }
}
