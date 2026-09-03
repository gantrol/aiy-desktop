import { app, BrowserWindow } from 'electron';
import { AppUpdateRecoveryStore } from '@/main/app/app-update-recovery-store';
import type { AppUpdateRecoveryBackend, AppUpdateRecoveryRecord } from '@/main/app/app-update-recovery-store';
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

const POST_FIRST_WINDOW_SHOW_CHECK_DELAY_MS = 1_000;
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface AppUpdateServiceEnvironment {
  storeUpdater?: WindowsStoreUpdateBackend;
  recoveryStore?: AppUpdateRecoveryBackend;
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

function appVersionForStoreVersion(storeVersion: string | null) {
  if (!storeVersion) return null;
  const fields = storeVersion.split('.').map((field) => Number.parseInt(field, 10));
  if (fields.length !== 4 || fields.some((field) => !Number.isInteger(field))) return storeVersion;
  const [major, minor, build, revision] = fields;
  if (major < 1 || revision !== 0) return storeVersion;
  return `${major - 1}.${minor}.${build}`;
}

export class AppUpdateService {
  private state: AppUpdateStateDto;
  private checkPromise: Promise<AppUpdateStateDto> | null = null;
  private downloadPromise: Promise<AppUpdateStateDto> | null = null;
  private installPromise: Promise<AppUpdateStateDto> | null = null;
  private recoveryPromise: Promise<AppUpdateStateDto> | null = null;
  private installPrepared = false;
  private installFailureRecovery: (() => void) | null = null;
  private automaticCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private automaticCheckInterval: ReturnType<typeof setInterval> | null = null;
  private hasStartedCheck = false;
  private initialized = false;
  private disposed = false;
  private registeredRestartRequired = false;
  private recoveryRecord: AppUpdateRecoveryRecord | null = null;
  private readonly storeUpdater: WindowsStoreUpdateBackend;
  private readonly recoveryStore: AppUpdateRecoveryBackend;
  private readonly getNativeWindowHandle: () => Buffer | null;

  constructor(
    private readonly sendState: (state: AppUpdateStateDto) => void,
    environment: AppUpdateServiceEnvironment = {},
  ) {
    const supportReason = detectUnsupportedReason();
    this.storeUpdater = environment.storeUpdater ?? new WindowsStoreUpdateClient();
    this.recoveryStore = environment.recoveryStore ?? new AppUpdateRecoveryStore(app.getPath('userData'));
    this.getNativeWindowHandle =
      environment.getNativeWindowHandle ??
      (() => {
        const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
        return window?.getNativeWindowHandle() ?? null;
      });
    this.state = appUpdateStateSchema.parse({
      phase: supportReason ? 'UNSUPPORTED' : 'IDLE',
      currentVersion: app.getVersion(),
      targetVersion: null,
      supportReason,
      progress: null,
      error: null,
    });
  }

  async initialize() {
    if (this.initialized || this.state.phase === 'UNSUPPORTED') return this;
    this.initialized = true;
    try {
      const record = await this.recoveryStore.load();
      if (this.disposed || !record) return this;
      if (record.sourceVersion !== this.state.currentVersion) {
        await this.clearRecoveryBestEffort();
        return this;
      }
      this.recoveryRecord = record;
      this.replaceState({
        phase: record.phase === 'DOWNLOADED' ? 'READY' : 'CHECKING',
        targetVersion: appVersionForStoreVersion(record.targetStoreVersion),
        progress: null,
        error: null,
      });
    } catch (error) {
      console.error('[app-update] failed to load update recovery state', { diagnostic: errorDiagnostic(error) });
    }
    return this;
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
      if (this.recoveryRecord?.phase === 'INSTALL_REQUESTED') {
        void this.recoverPendingInstall();
      } else if (!this.hasStartedCheck && this.state.phase !== 'READY') {
        void this.check();
      }
      this.automaticCheckInterval = setInterval(() => {
        if (this.recoveryRecord?.phase === 'INSTALL_REQUESTED') void this.recoverPendingInstall();
        else void this.check();
      }, AUTOMATIC_CHECK_INTERVAL_MS);
      this.automaticCheckInterval.unref();
    }, POST_FIRST_WINDOW_SHOW_CHECK_DELAY_MS);
    this.automaticCheckTimer.unref();
  }

  check(): Promise<AppUpdateStateDto> {
    if (
      this.disposed ||
      this.downloadPromise ||
      this.installPromise ||
      this.recoveryPromise ||
      this.state.phase === 'UNSUPPORTED' ||
      this.state.phase === 'AVAILABLE' ||
      this.state.phase === 'DOWNLOADING' ||
      this.state.phase === 'INSTALLING' ||
      this.state.phase === 'RESTART_REQUIRED' ||
      this.state.phase === 'READY'
    ) {
      return Promise.resolve(this.getState());
    }
    if (this.checkPromise) return this.checkPromise;

    this.hasStartedCheck = true;
    this.replaceState({ phase: 'CHECKING', targetVersion: null, progress: null, error: null });
    this.checkPromise = this.storeUpdater
      .check()
      .then((result) => {
        this.replaceState({
          phase: result.available ? 'AVAILABLE' : 'UP_TO_DATE',
          targetVersion: appVersionForStoreVersion(result.targetStoreVersion),
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
    if (this.disposed || !canDownload || this.checkPromise || this.installPromise || this.recoveryPromise) {
      return Promise.resolve(this.getState());
    }

    this.replaceState({
      phase: 'DOWNLOADING',
      progress: { percent: 0, transferred: 0, total: 0 },
      error: null,
    });
    this.downloadPromise = Promise.resolve()
      .then(() => this.storeUpdater.download(this.requireNativeWindowHandle(), this.handleMicrosoftStoreProgress))
      .then(async (result) => {
        await this.persistRecovery('DOWNLOADED', result.targetStoreVersion);
        this.replaceState({
          phase: 'READY',
          targetVersion: appVersionForStoreVersion(result.targetStoreVersion),
          progress: null,
          error: null,
        });
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
    if (this.recoveryPromise) return this.recoveryPromise;
    if (this.recoveryRecord?.phase === 'INSTALL_REQUESTED' && !this.registeredRestartRequired) {
      return this.recoverPendingInstall();
    }
    const canInstall =
      this.state.phase === 'READY' ||
      this.state.phase === 'RESTART_REQUIRED' ||
      (this.state.phase === 'ERROR' && this.state.error?.action === 'INSTALL' && this.state.error.retryable);
    if (this.disposed || !canInstall || this.checkPromise || this.downloadPromise) return this.getState();

    this.installFailureRecovery = recoverInstallFailure;
    this.installPromise = this.registeredRestartRequired
      ? this.performRegisteredRestart(prepareInstall)
      : this.performInstall(prepareInstall);
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

  private recoverPendingInstall() {
    if (this.recoveryPromise) return this.recoveryPromise;
    const record = this.recoveryRecord;
    if (this.disposed || record?.phase !== 'INSTALL_REQUESTED') return Promise.resolve(this.getState());

    this.hasStartedCheck = true;
    this.replaceState({ phase: 'CHECKING', progress: null, error: null });
    this.recoveryPromise = this.storeUpdater
      .check()
      .then(async (result) => {
        if (result.available && result.targetStoreVersion === record.targetStoreVersion) {
          await this.persistRecovery('DOWNLOADED', record.targetStoreVersion);
          this.registeredRestartRequired = false;
          this.replaceState({
            phase: 'READY',
            targetVersion: appVersionForStoreVersion(record.targetStoreVersion),
            progress: null,
            error: null,
          });
        } else {
          this.registeredRestartRequired = true;
          this.replaceState({
            phase: 'RESTART_REQUIRED',
            targetVersion: appVersionForStoreVersion(record.targetStoreVersion),
            progress: null,
            error: null,
          });
        }
        return this.getState();
      })
      .catch((error: unknown) => {
        this.recordError('INSTALL', error);
        return this.getState();
      })
      .finally(() => {
        this.recoveryPromise = null;
      });
    return this.recoveryPromise;
  }

  private async performInstall(prepareInstall: () => Promise<boolean>) {
    let storeInstallCompleted = false;
    try {
      const windowHandle = this.requireNativeWindowHandle();
      if (!(await prepareInstall())) return this.getState();
      this.installPrepared = true;
      const targetStoreVersion = this.recoveryRecord?.targetStoreVersion;
      if (!targetStoreVersion) throw new WindowsStoreUpdateError('STORE_UPDATE_RECOVERY_MISSING', true);
      await this.persistRecovery('INSTALL_REQUESTED', targetStoreVersion);
      this.replaceState({ phase: 'INSTALLING', progress: null, error: null });
      await this.storeUpdater.install(windowHandle);
      storeInstallCompleted = true;
      await this.finishInstalledUpdate();
    } catch (error) {
      let failure = error;
      if (
        !storeInstallCompleted &&
        error instanceof WindowsStoreUpdateError &&
        error.code === 'STORE_UPDATE_NO_LONGER_AVAILABLE'
      ) {
        try {
          await this.restartIntoRegisteredPackage();
          return this.getState();
        } catch (restartError) {
          failure = restartError;
        }
      } else if (!storeInstallCompleted) {
        await this.restoreDownloadedRecoveryBestEffort();
      }
      this.recordError('INSTALL', failure);
      this.recoverPreparedInstall();
    }
    return this.getState();
  }

  private async performRegisteredRestart(prepareInstall: () => Promise<boolean>) {
    try {
      if (!(await prepareInstall())) return this.getState();
      this.installPrepared = true;
      this.replaceState({ phase: 'INSTALLING', progress: null, error: null });
      await this.restartIntoRegisteredPackage();
    } catch (error) {
      this.recordError('INSTALL', error);
      this.recoverPreparedInstall();
    }
    return this.getState();
  }

  private async restartIntoRegisteredPackage() {
    app.releaseSingleInstanceLock();
    try {
      await this.storeUpdater.activate();
    } catch (error) {
      if (!app.requestSingleInstanceLock()) {
        await this.clearRecoveryBestEffort();
        app.exit(0);
        return;
      }
      throw error;
    }
    await this.clearRecoveryBestEffort();
    app.exit(0);
  }

  private async finishInstalledUpdate() {
    await this.clearRecoveryBestEffort();
    app.exit(0);
  }

  private async persistRecovery(phase: AppUpdateRecoveryRecord['phase'], targetStoreVersion: string) {
    const record: AppUpdateRecoveryRecord = {
      schemaVersion: 1,
      sourceVersion: this.state.currentVersion,
      targetStoreVersion,
      phase,
      updatedAt: Date.now(),
    };
    await this.recoveryStore.save(record);
    this.recoveryRecord = record;
  }

  private async restoreDownloadedRecoveryBestEffort() {
    const targetStoreVersion = this.recoveryRecord?.targetStoreVersion;
    if (!targetStoreVersion) return;
    try {
      await this.persistRecovery('DOWNLOADED', targetStoreVersion);
      this.registeredRestartRequired = false;
    } catch (error) {
      console.error('[app-update] failed to restore downloaded update state', { diagnostic: errorDiagnostic(error) });
    }
  }

  private async clearRecoveryBestEffort() {
    this.recoveryRecord = null;
    this.registeredRestartRequired = false;
    try {
      await this.recoveryStore.clear();
    } catch (error) {
      console.error('[app-update] failed to clear update recovery state', { diagnostic: errorDiagnostic(error) });
    }
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
