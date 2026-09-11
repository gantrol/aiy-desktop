import { app, BrowserWindow, dialog, Menu, nativeImage, screen, Tray, type Rectangle } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodexService } from '@/main/assistant/codex-service';
import { TrayMenuWindow } from '@/main/app/tray-menu-window';
import { appShellMessages } from '@/shared/i18n/app-shell';
import {
  trayPetalActions,
  trayTaskStatus,
  type TrayPetalAction,
  type AppShellLanguage,
  type TrayMenuState,
} from '@/shared/contracts/tray-menu';
import { AppUpdateService } from '@/main/app/app-update-service';
import { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import { PACKAGED_RENDERER_URL } from '@/main/app/renderer-protocol';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import { installWindowNavigationPolicy } from '@/main/app/window-security';
import { runDevelopmentCapture } from '@/main/development/capture';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { closeSandboxedImageDecoder } from '@/main/media/sandboxed-image-decoder';
import type { BackgroundGenerationClient } from '@/main/model-worker/client';
import { productNameForLocale } from '@/shared/product';
import { appWindowStateSchema } from '@/shared/contracts/app-window';
import { WindowStateStore } from '@/main/app/window-state-store';
import { cancelArticleEditorDrain, drainArticleEditors } from '@/main/app/article-editor-drain';
import { attachRendererDiagnostics, flushRendererDiagnostics } from '@/main/app/renderer-diagnostics';

const DEFAULT_WINDOW_WIDTH = 1_500;
const DEFAULT_WINDOW_HEIGHT = 920;
const MINIMUM_WINDOW_WIDTH = 1_100;
const MINIMUM_WINDOW_HEIGHT = 720;
const DEVELOPMENT_APP_USER_MODEL_ID = 'com.catai.aiy.dev';

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
  drainDesktopPetals?(): Promise<boolean>;
  resumeDesktopPetals?(): void;
  desktopPetals?(): { readonly ready: boolean; run(action: TrayPetalAction): Promise<void> } | null;
}

export class DesktopApplicationShell {
  mainWindow: BrowserWindow | null = null;
  private mainWindowReady = false;

  private backgroundServicesStartDeferred = false;

  private generation: BackgroundGenerationClient | null = null;

  private codexAdapter: CodexService | null = null;

  private appTray: Tray | null = null;
  private trayMenu: TrayMenuWindow | null = null;
  private language: AppShellLanguage = { locale: 'en', messages: appShellMessages };

  readonly setLanguage = (language: AppShellLanguage) => {
    this.language = language;
    this.updateAppTray();
  };

  private readonly trayState = (): TrayMenuState => ({
    language: this.language,
    petalsReady: this.options.desktopPetals?.()?.ready ?? false,
    windowReady: Boolean(this.mainWindow && !this.mainWindow.isDestroyed()),
    taskCount: this.pendingModelTaskCount(),
    quittingSoon: this.quitAfterBackgroundTasks && this.backgroundCompletionNotified,
  });

  private appQuitRequested = false;
  private rendererDrainComplete = false;
  private rendererDrainPending = false;

  private backgroundCompletionNotified = false;

  private backgroundCompletionTimer: ReturnType<typeof setTimeout> | null = null;

  private backgroundAutoExitTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingCloseGuardOpen = false;

  private quitAfterBackgroundTasks = false;

  private forceQuitRequested = false;

  private libraryContextShutdownComplete = false;

  private libraryContextShutdownPromise: Promise<void> | null = null;

  private applicationShutdownPromise: Promise<void> | null = null;

  private applicationShutdownComplete = false;

  private appUpdates: AppUpdateService | null = null;

  appUpdateInstallPreparing = false;

  private appUpdateRecoveryRequested = false;

  libraryTransitionPending = false;

  activeLibraryContext: ActiveLibraryContext | null = null;

  private readonly BACKGROUND_AUTO_EXIT_DELAY_MS = 30_000;

  private readonly showMainWindow = () => {
    if (!this.options.allowWindowPresentation) return;
    this.trayMenu?.hide();
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
    this.applicationShutdownPromise = Promise.allSettled([
      this.options.stopManagedLocalModels?.() ?? Promise.resolve(),
      this.options.stopBackgroundFileOperations?.() ?? Promise.resolve(),
      this.shutdownActiveLibraryContext(),
    ])
      .then((results) => {
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) {
          throw new AggregateError(
            failures.map((result) => result.reason),
            'Application service cleanup failed',
          );
        }
      })
      .finally(flushRendererDiagnostics)
      .finally(() => {
        this.applicationShutdownComplete = true;
      });
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
        const copy = this.language.messages;
        const options: Electron.MessageBoxOptions = {
          type: 'warning',
          title: productNameForLocale(this.language.locale),
          message: copy.updatePending.replace('{count}', String(count)),
          detail: copy.updateDetail,
          buttons: [copy.cancelAndUpdate, copy.notNow],
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
      if (!(await drainArticleEditors(this.mainWindow))) return false;
      if (!((await this.options.drainDesktopPetals?.()) ?? true)) return false;
      this.rendererDrainComplete = true;
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
      if (!prepared) {
        this.appUpdateInstallPreparing = false;
        if (!this.appUpdateRecoveryRequested) {
          this.rendererDrainComplete = false;
          cancelArticleEditorDrain(this.mainWindow);
          this.options.resumeDesktopPetals?.();
        }
      }
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
    const copy = this.language.messages;
    const productName = productNameForLocale(this.language.locale);
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: productName,
      message: copy.forceQuitQuestion,
      detail: reason ? `${reason}\n\n${copy.forceQuitDetail}` : copy.forceQuitDetail,
      buttons: [copy.goBack, copy.forceQuit],
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
    const copy = this.language.messages;
    const productName = productNameForLocale(this.language.locale);
    try {
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: productName,
        message: copy.pendingClose.replace('{count}', String(count)),
        detail: copy.pendingCloseDetail,
        buttons: [copy.continueBackground, copy.cancelAndQuit, copy.forceQuitPending, copy.goBack],
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
          const forced = await this.confirmForceQuit(copy.cancelFailed.replace('{reason}', message));
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
      await this.confirmForceQuit(this.language.messages.shutdownFailed.replace('{reason}', message));
    }
  };

  // Keep a localized native escape hatch only if the custom menu cannot load.
  private readonly trayMenuFailed = (error: unknown) => {
    console.error('[tray-menu] Failed to show the application menu', error);
    this.appTray?.popUpContextMenu(this.nativeTrayMenu());
  };

  private readonly runTrayPetalAction = async (action: TrayPetalAction) => {
    if (!this.options.desktopPetals?.()?.ready) return;
    try {
      await this.options.desktopPetals?.()?.run(action);
    } catch (error) {
      console.error('[tray-menu] Petals action failed', error);
      if (this.options.allowWindowPresentation) dialog.showErrorBox(this.language.messages[action], String(error));
    }
  };

  private readonly nativeTrayMenu = () => {
    const state = this.trayState();
    const copy = this.language.messages;
    return Menu.buildFromTemplate([
      { label: copy.open, enabled: state.windowReady, click: this.showMainWindow },
      { type: 'separator' },
      ...trayPetalActions.map((action) => ({
        label: copy[action],
        enabled: state.petalsReady,
        click: () => {
          void this.runTrayPetalAction(action);
        },
      })),
      { type: 'separator' },
      { label: trayTaskStatus(state, copy), enabled: false },
      { type: 'separator' },
      {
        label: state.taskCount > 0 ? copy.quitPending : copy.quit,
        click: () => {
          void this.requestAppQuit();
        },
      },
      ...(state.taskCount > 0
        ? [
            {
              label: copy.forceQuitPending,
              click: () => {
                void this.confirmForceQuit();
              },
            },
          ]
        : []),
    ]);
  };

  readonly updateAppTray = () => {
    if (!this.appTray) return;
    const count = this.pendingModelTaskCount();
    const copy = this.language.messages;
    const productName = productNameForLocale(this.language.locale);
    this.appTray.setToolTip(count > 0 ? copy.tasksTooltip.replace('{count}', String(count)) : productName);
    // Electron only emits tray right-click on Windows and macOS.
    if (process.platform === 'linux') this.appTray.setContextMenu(this.nativeTrayMenu());
    this.trayMenu?.update();
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
      if (process.platform === 'linux') this.appTray.setContextMenu(this.nativeTrayMenu());
      this.trayMenu?.update();
      if (process.platform === 'win32')
        this.appTray.displayBalloon({
          title: productName,
          content: this.language.messages.completionNotification,
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
    this.trayMenu ??= new TrayMenuWindow(
      () => this.developmentRendererUrl() ?? new URL(PACKAGED_RENDERER_URL),
      this.trayState,
      async (action) => {
        if (trayPetalActions.some((petalAction) => petalAction === action))
          await this.runTrayPetalAction(action as TrayPetalAction);
        if (action === 'open') this.showMainWindow();
        if (action === 'quit') await this.requestAppQuit();
        if (action === 'force-quit') await this.confirmForceQuit();
      },
      this.trayMenuFailed,
    );
    this.appTray.on('right-click', () => {
      if (this.options.allowWindowPresentation) this.trayMenu?.show(screen.getCursorScreenPoint());
    });
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
    const candidates = isPackagedApplication(app)
      ? [path.join(process.resourcesPath, iconName)]
      : [path.resolve(__dirname, '../../build', iconName), path.join(app.getAppPath(), 'build', iconName)];
    const iconPath = candidates.find((candidate) => existsSync(candidate));
    if (iconPath) return iconPath;
    console.warn('[startup] Application icon is unavailable', { candidates });
    return nativeImage.createEmpty();
  };

  readonly developmentRendererUrl = () => {
    return !isPackagedApplication(app) && process.env.ELECTRON_RENDERER_URL
      ? new URL(process.env.ELECTRON_RENDERER_URL)
      : null;
  };

  readonly createWindow = () => {
    const expectedRendererUrl = this.developmentRendererUrl() ?? new URL(PACKAGED_RENDERER_URL);
    const icon = this.appIcon();
    const windowStateStore = new WindowStateStore(app.getPath('userData'));
    const restoredWindowState = windowStateStore.load();
    const restoredBounds = restoredWindowState ? restoreWindowBounds(restoredWindowState.normalBounds) : null;
    const window = new BrowserWindow({
      ...(restoredBounds ?? { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }),
      minWidth: MINIMUM_WINDOW_WIDTH,
      minHeight: MINIMUM_WINDOW_HEIGHT,
      backgroundColor: this.options.backgroundColor,
      title: this.options.title,
      icon,
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
    if (process.platform === 'win32') {
      const applyTaskbarIdentity = () => {
        window.setIcon(icon);
        if (isPackagedApplication(app) || typeof icon !== 'string') return;
        // The branded executable has an immutable, icon-dependent directory.
        // Use its resource so Explorer does not reuse the cache for build/icon.ico.
        // Explicit Electron runtime overrides still need the standalone AIY icon.
        const taskbarIconPath = /^aiy-development-[a-f0-9]{16}$/i.test(path.basename(path.dirname(process.execPath)))
          ? process.execPath
          : icon;
        // Reapply both the native icon and shell identity when Windows recreates
        // the taskbar button after a tray restore.
        window.setAppDetails({
          appId: DEVELOPMENT_APP_USER_MODEL_ID,
          appIconPath: taskbarIconPath,
          appIconIndex: 0,
          relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
          relaunchDisplayName: this.options.title,
        });
      };
      applyTaskbarIdentity();
      window.on('show', applyTaskbarIdentity);
    }
    this.mainWindow = window;
    this.mainWindowReady = false;
    attachRendererDiagnostics(window);
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
      if (this.mainWindow === window) {
        this.mainWindow = null;
        this.mainWindowReady = false;
      }
    });
    if (!isPackagedApplication(app) && process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void window.loadURL(PACKAGED_RENDERER_URL);
    }
    if (restoredWindowState?.maximized) window.maximize();
    window.once('ready-to-show', async () => {
      this.mainWindowReady = true;
      this.showMainWindow();
      this.updateAppTray();
      this.requestBackgroundServicesStart();
      this.appUpdates?.startAutomaticChecks();
      const restartReadyFile = process.env.AIY_RESTART_READY_FILE;
      if (restartReadyFile) {
        delete process.env.AIY_RESTART_READY_FILE;
        try {
          await mkdir(path.dirname(restartReadyFile), { recursive: true });
          await writeFile(restartReadyFile, 'ready', 'utf8');
        } catch (error) {
          console.error('[startup] Failed to write restart ready file', error);
        }
      }
      await runDevelopmentCapture(window);
    });
  };

  constructor(
    private readonly rendererEvents: RendererEventDispatcher,
    private readonly options: DesktopApplicationShellOptions,
  ) {
    if (process.platform === 'win32' && !isPackagedApplication(app)) {
      app.setAppUserModelId(DEVELOPMENT_APP_USER_MODEL_ID);
    }

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
      if (!this.forceQuitRequested && !this.rendererDrainComplete) {
        event.preventDefault();
        if (!this.rendererDrainPending) {
          this.rendererDrainPending = true;
          void drainArticleEditors(this.mainWindow)
            .then(async (saved) => saved && ((await this.options.drainDesktopPetals?.()) ?? true))
            .catch((error) => {
              console.error('[shutdown] failed to finish saving editors', error);
              return false;
            })
            .then((saved) => {
              this.rendererDrainPending = false;
              if (!saved) {
                this.appQuitRequested = false;
                cancelArticleEditorDrain(this.mainWindow);
                this.options.resumeDesktopPetals?.();
                this.showMainWindow();
                return;
              }
              this.rendererDrainComplete = true;
              app.quit();
            });
        }
        return;
      }
      this.appQuitRequested = true;
      this.quitAfterBackgroundTasks = false;
      if (this.backgroundCompletionTimer) clearTimeout(this.backgroundCompletionTimer);
      this.backgroundCompletionTimer = null;
      if (this.backgroundAutoExitTimer) clearTimeout(this.backgroundAutoExitTimer);
      this.backgroundAutoExitTimer = null;
      this.trayMenu?.dispose();
      this.appTray?.destroy();
      this.appTray = null;
      this.appUpdates?.dispose();
      this.appUpdates = null;
      // A repeated quit must wait even after cleanup detaches the active context.
      if (!this.forceQuitRequested && !this.applicationShutdownComplete) {
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
    this.applicationShutdownComplete = false;
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
    if (this.mainWindowReady) updates.startAutomaticChecks();
  }

  markQuitRequested() {
    this.appQuitRequested = true;
  }
}
