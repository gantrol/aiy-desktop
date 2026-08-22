import { app, BrowserWindow } from 'electron';
import {
  WindowsStoreUpdateClient,
  WindowsStoreUpdateError,
  type WindowsStoreProgress,
  type WindowsStoreUpdateBackend,
} from '@/main/app/windows-store-update-client';
import {
  appUpdateStateSchema,
  type AppUpdateErrorAction,
  type AppUpdateStateDto,
  type AppUpdateSupportReason,
} from '@/shared/contracts/app-update';

const INITIAL_AUTOMATIC_CHECK_DELAY_MS = 30_000;
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface AppUpdateServiceEnvironment {
  storeUpdater?: WindowsStoreUpdateBackend;
  getNativeWindowHandle?: () => Buffer | null;
}

function detectUnsupportedReason(): AppUpdateSupportReason | null {
  if (!app.isPackaged) return 'DEVELOPMENT';
  if (process.platform !== 'win32') return 'PLATFORM';
  if (!process.windowsStore) return 'NOT_MICROSOFT_STORE';
  return null;
}

function normalizedErrorCode(error: unknown) {
  const externalCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const normalized = externalCode
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return normalized || 'STORE_UPDATE_FAILED';
}

function errorDiagnostic(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 100),
      message: error.message.slice(0, 2_000),
      stack: error.stack?.slice(0, 4_000),
    };
  }
  return {
    name: typeof error,
    message: typeof error === 'string' ? error.slice(0, 2_000) : 'Unknown Microsoft Store update error',
  };
}

export class AppUpdateService {
  private state: AppUpdateStateDto;
  private checkPromise: Promise<AppUpdateStateDto> | null = null;
  private downloadPromise: Promise<AppUpdateStateDto> | null = null;
  private installPromise: Promise<AppUpdateStateDto> | null = null;
  private installPrepared = false;
  private installFailureRecovery: (() => void) | null = null;
  private automaticCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private automaticCheckInterval: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly storeUpdater: WindowsStoreUpdateBackend;
  private readonly getNativeWindowHandle: () => Buffer | null;

  constructor(
    private readonly sendState: (state: AppUpdateStateDto) => void,
    environment: AppUpdateServiceEnvironment = {},
  ) {
    const supportReason = detectUnsupportedReason();
    this.storeUpdater = environment.storeUpdater ?? new WindowsStoreUpdateClient();
    this.getNativeWindowHandle =
      environment.getNativeWindowHandle ??
      (() => {
        const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
        return window?.getNativeWindowHandle() ?? null;
      });
    this.state = appUpdateStateSchema.parse({
      phase: supportReason ? 'UNSUPPORTED' : 'IDLE',
      currentVersion: app.getVersion(),
      supportReason,
      progress: null,
      error: null,
    });
  }

  getState() {
    return appUpdateStateSchema.parse(this.state);
  }

  startAutomaticChecks() {
    if (
      this.disposed ||
      this.state.phase === 'UNSUPPORTED' ||
      this.automaticCheckTimer ||
      this.automaticCheckInterval
    ) {
      return;
    }
    this.automaticCheckTimer = setTimeout(() => {
      this.automaticCheckTimer = null;
      void this.check();
      this.automaticCheckInterval = setInterval(() => void this.check(), AUTOMATIC_CHECK_INTERVAL_MS);
      this.automaticCheckInterval.unref();
    }, INITIAL_AUTOMATIC_CHECK_DELAY_MS);
    this.automaticCheckTimer.unref();
  }

  check(): Promise<AppUpdateStateDto> {
    if (
      this.disposed ||
      this.downloadPromise ||
      this.installPromise ||
      this.state.phase === 'UNSUPPORTED' ||
      this.state.phase === 'AVAILABLE' ||
      this.state.phase === 'DOWNLOADING' ||
      this.state.phase === 'INSTALLING' ||
      this.state.phase === 'READY'
    ) {
      return Promise.resolve(this.getState());
    }
    if (this.checkPromise) return this.checkPromise;

    this.replaceState({ phase: 'CHECKING', progress: null, error: null });
    this.checkPromise = this.storeUpdater
      .check()
      .then((result) => {
        this.replaceState({
          phase: result.available ? 'AVAILABLE' : 'UP_TO_DATE',
          progress: null,
          error: null,
        });
        return this.getState();
      })
      .catch((error: unknown) => {
        this.recordError('CHECK', error);
        return this.getState();
      })
      .finally(() => {
        this.checkPromise = null;
      });
    return this.checkPromise;
  }

  download(): Promise<AppUpdateStateDto> {
    if (this.downloadPromise) return this.downloadPromise;
    const canDownload =
      this.state.phase === 'AVAILABLE' ||
      (this.state.phase === 'ERROR' && this.state.error?.action === 'DOWNLOAD' && this.state.error.retryable);
    if (this.disposed || !canDownload || this.checkPromise || this.installPromise) {
      return Promise.resolve(this.getState());
    }

    this.replaceState({
      phase: 'DOWNLOADING',
      progress: { percent: 0, transferred: 0, total: 0 },
      error: null,
    });
    this.downloadPromise = Promise.resolve()
      .then(() => this.storeUpdater.download(this.requireNativeWindowHandle(), this.handleMicrosoftStoreProgress))
      .then(() => {
        this.replaceState({ phase: 'READY', progress: null, error: null });
        return this.getState();
      })
      .catch((error: unknown) => {
        this.recordError('DOWNLOAD', error);
        return this.getState();
      })
      .finally(() => {
        this.downloadPromise = null;
      });
    return this.downloadPromise;
  }

  async install(prepareInstall: () => Promise<boolean>, recoverInstallFailure: () => void = () => undefined) {
    if (this.installPromise) return this.installPromise;
    const canInstall =
      this.state.phase === 'READY' ||
      (this.state.phase === 'ERROR' && this.state.error?.action === 'INSTALL' && this.state.error.retryable);
    if (this.disposed || !canInstall || this.checkPromise || this.downloadPromise) return this.getState();

    this.installFailureRecovery = recoverInstallFailure;
    this.installPromise = this.performInstall(prepareInstall);
    try {
      return await this.installPromise;
    } finally {
      this.installPromise = null;
      if (!this.installPrepared) this.installFailureRecovery = null;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.automaticCheckTimer) clearTimeout(this.automaticCheckTimer);
    if (this.automaticCheckInterval) clearInterval(this.automaticCheckInterval);
    this.automaticCheckTimer = null;
    this.automaticCheckInterval = null;
    this.storeUpdater.dispose();
  }

  private async performInstall(prepareInstall: () => Promise<boolean>) {
    try {
      const windowHandle = this.requireNativeWindowHandle();
      if (!(await prepareInstall())) return this.getState();
      this.installPrepared = true;
      this.replaceState({ phase: 'INSTALLING', progress: null, error: null });
      await this.storeUpdater.install(windowHandle);
      app.relaunch();
      app.exit(0);
    } catch (error) {
      this.recordError('INSTALL', error);
      this.recoverPreparedInstall();
    }
    return this.getState();
  }

  private readonly handleMicrosoftStoreProgress = (progress: WindowsStoreProgress) => {
    if (this.disposed || this.state.phase !== 'DOWNLOADING') return;
    this.replaceState({
      phase: 'DOWNLOADING',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      },
      error: null,
    });
  };

  private requireNativeWindowHandle() {
    const handle = this.getNativeWindowHandle();
    if (!handle || !Buffer.isBuffer(handle)) {
      throw new WindowsStoreUpdateError('STORE_WINDOW_UNAVAILABLE', true);
    }
    return Buffer.from(handle);
  }

  private replaceState(patch: Partial<AppUpdateStateDto>) {
    this.state = appUpdateStateSchema.parse({ ...this.state, ...patch });
    this.sendState(this.getState());
  }

  private recordError(action: AppUpdateErrorAction, error: unknown) {
    const code = normalizedErrorCode(error);
    console.error('[app-update] Microsoft Store operation failed', {
      action,
      code,
      diagnostic: errorDiagnostic(error),
    });
    this.replaceState({
      phase: 'ERROR',
      progress: null,
      error: {
        action,
        code,
        retryable: error instanceof WindowsStoreUpdateError ? error.retryable : false,
      },
    });
  }

  private recoverPreparedInstall() {
    if (!this.installPrepared) return;
    const recover = this.installFailureRecovery;
    this.installPrepared = false;
    this.installFailureRecovery = null;
    try {
      recover?.();
    } catch (error) {
      console.error('[app-update] failed to recover from a Microsoft Store installation error', {
        diagnostic: errorDiagnostic(error),
      });
    }
  }
}
