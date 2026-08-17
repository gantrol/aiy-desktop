import { app } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import electronUpdater, { type AppUpdater } from 'electron-updater';
import { load as loadYaml } from 'js-yaml';
import { z } from 'zod';
import {
  appUpdateStateSchema,
  type AppUpdateErrorAction,
  type AppUpdateStateDto,
  type AppUpdateSupportReason,
} from '@/shared/contracts/app-update';

const { autoUpdater } = electronUpdater;

const INITIAL_AUTOMATIC_CHECK_DELAY_MS = 30_000;
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MAX_UPDATE_FILE_BYTES = 2 * 1_024 * 1_024 * 1_024;
const MAX_BLOCK_MAP_BYTES = 64 * 1_024 * 1_024;
const MAX_DOWNLOAD_RATE_BYTES_PER_SECOND = 16 * 1_024 * 1_024 * 1_024;

const updateVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const updateFileSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2_048)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._+() -]*$/),
  sha512: z
    .string()
    .length(88)
    .regex(/^[A-Za-z0-9+/]{86}==$/),
  size: z.number().int().positive().max(MAX_UPDATE_FILE_BYTES),
  blockMapSize: z.number().int().positive().max(MAX_BLOCK_MAP_BYTES).optional(),
  isAdminRightsRequired: z.boolean().optional(),
});
const providerUpdateInfoSchema = z.object({
  version: updateVersionSchema,
  files: z.array(updateFileSchema).min(1).max(16),
  releaseDate: z.string().datetime({ offset: true }),
  stagingPercentage: z.number().min(0).max(100).optional(),
  minimumSystemVersion: z
    .string()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+){1,3}$/)
    .optional(),
});
const providerProgressSchema = z
  .object({
    percent: z.number().finite(),
    transferred: z.number().int().nonnegative().max(MAX_UPDATE_FILE_BYTES),
    total: z.number().int().nonnegative().max(MAX_UPDATE_FILE_BYTES),
    bytesPerSecond: z.number().finite().nonnegative().max(MAX_DOWNLOAD_RATE_BYTES_PER_SECOND),
  })
  .refine(({ total, transferred }) => (total === 0 ? transferred === 0 : transferred <= total));
const publisherNameSchema = z.string().trim().min(1).max(256);
const publisherNamesSchema = z.union([publisherNameSchema, z.array(publisherNameSchema).min(1).max(8)]);
const packagedUpdateConfigSchema = z.object({
  provider: z.literal('github'),
  owner: z.literal('gantrol'),
  repo: z.literal('aiy-desktop'),
  updaterCacheDirName: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9@._-]+$/),
  publisherName: publisherNamesSchema.optional(),
});

interface UpdateSupport {
  supported: boolean;
  reason: AppUpdateSupportReason | null;
}

function detectUpdateSupport(): UpdateSupport {
  if (!app.isPackaged) return { supported: false, reason: 'DEVELOPMENT' };
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { supported: false, reason: 'PLATFORM' };
  }

  if (process.platform === 'win32') {
    try {
      const packageType = readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim();
      if (packageType !== 'nsis') return { supported: false, reason: 'PACKAGE_TYPE' };
    } catch {
      return { supported: false, reason: 'PACKAGE_TYPE' };
    }
  }

  try {
    const config = packagedUpdateConfigSchema.safeParse(
      loadYaml(readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')),
    );
    if (!config.success) return { supported: false, reason: 'CONFIGURATION' };
    if (process.platform === 'win32' && !publisherNamesSchema.safeParse(config.data.publisherName).success) {
      return { supported: false, reason: 'SIGNATURE' };
    }
    return { supported: true, reason: null };
  } catch {
    return { supported: false, reason: 'CONFIGURATION' };
  }
}

function normalizedErrorCode(error: unknown) {
  const externalCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const normalized = externalCode
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return normalized || 'UPDATE_FAILED';
}

function errorDiagnostic(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 100),
      message: error.message.slice(0, 2_000),
      stack: error.stack?.slice(0, 4_000),
    };
  }
  return { name: typeof error, message: typeof error === 'string' ? error.slice(0, 2_000) : 'Unknown updater error' };
}

function isRetryableError(code: string, error: unknown) {
  const message = errorDiagnostic(error).message;
  return !/SIGNATURE|CHECKSUM|SHA512|MALFORMED|INVALID_UPDATE|NOT_SUPPORTED/i.test(`${code} ${message}`);
}

export class AppUpdateService {
  private state: AppUpdateStateDto;
  private checkPromise: Promise<AppUpdateStateDto> | null = null;
  private downloadPromise: Promise<AppUpdateStateDto> | null = null;
  private installPromise: Promise<AppUpdateStateDto> | null = null;
  private installPrepared = false;
  private installFailureRecovery: (() => void) | null = null;
  private currentAction: AppUpdateErrorAction | null = null;
  private automaticCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private automaticCheckInterval: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly sendState: (state: AppUpdateStateDto) => void,
    private readonly updater: AppUpdater = autoUpdater,
  ) {
    const support = detectUpdateSupport();
    this.state = appUpdateStateSchema.parse({
      phase: support.supported ? 'IDLE' : 'UNSUPPORTED',
      currentVersion: app.getVersion(),
      supportReason: support.reason,
      targetVersion: null,
      releaseDate: null,
      progress: null,
      error: null,
    });
    if (!support.supported) return;

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.disableDifferentialDownload = false;
    const defaultUpdateSupport = updater.isUpdateSupported;
    updater.isUpdateSupported = async (info) =>
      providerUpdateInfoSchema.safeParse(info).success && (await defaultUpdateSupport(info));
    updater.on('checking-for-update', this.handleCheckingForUpdate);
    updater.on('update-available', this.handleUpdateAvailable);
    updater.on('update-not-available', this.handleUpdateNotAvailable);
    updater.on('download-progress', this.handleDownloadProgress);
    updater.on('update-downloaded', this.handleUpdateDownloaded);
    updater.on('error', this.handleUpdaterError);
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

    this.currentAction = 'CHECK';
    this.replaceState({
      phase: 'CHECKING',
      targetVersion: null,
      releaseDate: null,
      progress: null,
      error: null,
    });
    this.checkPromise = Promise.resolve()
      .then(() => this.updater.checkForUpdates())
      .then(() => this.getState())
      .catch((error: unknown) => {
        this.recordError('CHECK', error);
        return this.getState();
      })
      .finally(() => {
        this.checkPromise = null;
        if (this.currentAction === 'CHECK') this.currentAction = null;
      });
    return this.checkPromise;
  }

  download(): Promise<AppUpdateStateDto> {
    if (this.downloadPromise) return this.downloadPromise;
    const canDownload =
      this.state.phase === 'AVAILABLE' ||
      (this.state.phase === 'ERROR' && this.state.error?.action === 'DOWNLOAD' && this.state.targetVersion !== null);
    if (!canDownload || this.disposed || this.checkPromise || this.installPromise) {
      return Promise.resolve(this.getState());
    }

    this.currentAction = 'DOWNLOAD';
    this.replaceState({
      phase: 'DOWNLOADING',
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      error: null,
    });
    this.downloadPromise = Promise.resolve()
      .then(() => this.updater.downloadUpdate())
      .then(() => this.getState())
      .catch((error: unknown) => {
        this.recordError('DOWNLOAD', error);
        return this.getState();
      })
      .finally(() => {
        this.downloadPromise = null;
        if (this.currentAction === 'DOWNLOAD') this.currentAction = null;
      });
    return this.downloadPromise;
  }

  async install(prepareInstall: () => Promise<boolean>, recoverInstallFailure: () => void = () => undefined) {
    if (this.installPromise) return this.installPromise;
    const canInstall =
      this.state.phase === 'READY' ||
      (this.state.phase === 'ERROR' && this.state.error?.action === 'INSTALL' && this.state.targetVersion !== null);
    if (!canInstall || this.disposed || this.checkPromise || this.downloadPromise) return this.getState();

    this.installFailureRecovery = recoverInstallFailure;
    this.installPromise = this.performInstall(prepareInstall);
    try {
      return await this.installPromise;
    } finally {
      this.installPromise = null;
      if (!this.installPrepared) this.installFailureRecovery = null;
    }
  }

  private async performInstall(prepareInstall: () => Promise<boolean>) {
    this.currentAction = 'INSTALL';
    try {
      if (!(await prepareInstall())) {
        this.currentAction = null;
        return this.getState();
      }
      this.installPrepared = true;
      this.replaceState({ phase: 'INSTALLING', progress: null, error: null });
      this.updater.quitAndInstall(false, true);
    } catch (error) {
      this.recordError('INSTALL', error);
      this.recoverPreparedInstall();
    }
    return this.getState();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.automaticCheckTimer) clearTimeout(this.automaticCheckTimer);
    if (this.automaticCheckInterval) clearInterval(this.automaticCheckInterval);
    this.automaticCheckTimer = null;
    this.automaticCheckInterval = null;
    if (this.state.phase === 'UNSUPPORTED') return;
    this.updater.off('checking-for-update', this.handleCheckingForUpdate);
    this.updater.off('update-available', this.handleUpdateAvailable);
    this.updater.off('update-not-available', this.handleUpdateNotAvailable);
    this.updater.off('download-progress', this.handleDownloadProgress);
    this.updater.off('update-downloaded', this.handleUpdateDownloaded);
    this.updater.off('error', this.handleUpdaterError);
  }

  private readonly handleCheckingForUpdate = () => {
    this.replaceState({ phase: 'CHECKING', progress: null, error: null });
  };

  private readonly handleUpdateAvailable = (rawInfo: unknown) => {
    const info = providerUpdateInfoSchema.safeParse(rawInfo);
    if (!info.success) {
      this.recordMalformedProviderData('CHECK', info.error);
      return;
    }
    this.replaceState({
      phase: 'AVAILABLE',
      targetVersion: info.data.version,
      releaseDate: info.data.releaseDate,
      progress: null,
      error: null,
    });
  };

  private readonly handleUpdateNotAvailable = (rawInfo: unknown) => {
    const info = providerUpdateInfoSchema.safeParse(rawInfo);
    if (!info.success) {
      this.recordMalformedProviderData('CHECK', info.error);
      return;
    }
    this.replaceState({
      phase: 'UP_TO_DATE',
      targetVersion: null,
      releaseDate: info.data.releaseDate,
      progress: null,
      error: null,
    });
  };

  private readonly handleDownloadProgress = (rawProgress: unknown) => {
    const progress = providerProgressSchema.safeParse(rawProgress);
    if (!progress.success) {
      console.error('[app-update] ignored malformed download progress', {
        diagnostic: errorDiagnostic(progress.error),
      });
      return;
    }
    this.replaceState({
      phase: 'DOWNLOADING',
      progress: {
        percent: Math.min(100, Math.max(0, progress.data.percent)),
        transferred: progress.data.transferred,
        total: progress.data.total,
        bytesPerSecond: progress.data.bytesPerSecond,
      },
      error: null,
    });
  };

  private readonly handleUpdateDownloaded = (rawInfo: unknown) => {
    const info = providerUpdateInfoSchema.safeParse(rawInfo);
    if (!info.success) {
      this.recordMalformedProviderData('DOWNLOAD', info.error);
      return;
    }
    this.replaceState({
      phase: 'READY',
      targetVersion: info.data.version,
      releaseDate: info.data.releaseDate,
      progress: null,
      error: null,
    });
  };

  private readonly handleUpdaterError = (error: Error) => {
    const action = this.currentAction ?? 'CHECK';
    this.recordError(action, error);
    if (action === 'INSTALL') this.recoverPreparedInstall();
  };

  private replaceState(patch: Partial<AppUpdateStateDto>) {
    this.state = appUpdateStateSchema.parse({ ...this.state, ...patch });
    this.sendState(this.getState());
  }

  private recordMalformedProviderData(action: AppUpdateErrorAction, error: unknown) {
    console.error('[app-update] rejected malformed provider data', { action, diagnostic: errorDiagnostic(error) });
    this.replaceState({
      phase: 'ERROR',
      progress: null,
      error: { action, code: 'MALFORMED_UPDATE_DATA', retryable: false },
    });
  }

  private recordError(action: AppUpdateErrorAction, error: unknown) {
    const code = normalizedErrorCode(error);
    console.error('[app-update] operation failed', { action, code, diagnostic: errorDiagnostic(error) });
    this.replaceState({
      phase: 'ERROR',
      progress: null,
      error: { action, code, retryable: isRetryableError(code, error) },
    });
  }

  private recoverPreparedInstall() {
    if (!this.installPrepared) {
      this.currentAction = null;
      return;
    }
    const recover = this.installFailureRecovery;
    this.installPrepared = false;
    this.installFailureRecovery = null;
    this.currentAction = null;
    try {
      recover?.();
    } catch (error) {
      console.error('[app-update] failed to recover from an installer launch error', {
        diagnostic: errorDiagnostic(error),
      });
    }
  }
}
