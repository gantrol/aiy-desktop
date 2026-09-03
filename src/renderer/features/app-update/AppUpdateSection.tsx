import { useEffect, useState } from 'react';
import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon, type LucideIcon } from 'lucide-react';
import type { AppUpdateStateDto } from '@/shared/contracts/app-update';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  active: boolean;
}

type SettingsMessages = ReturnType<typeof useI18n>['messages']['app']['settings'];

interface UpdateAction {
  label: string;
  run(): Promise<AppUpdateStateDto>;
  icon: LucideIcon;
}

const busyPhases = new Set<AppUpdateStateDto['phase']>(['CHECKING', 'DOWNLOADING', 'INSTALLING']);
const attentionPhases = new Set<AppUpdateStateDto['phase']>([
  'AVAILABLE',
  'DOWNLOADING',
  'READY',
  'INSTALLING',
  'RESTART_REQUIRED',
  'ERROR',
]);

function statusForState(
  state: AppUpdateStateDto | null,
  requestFailed: boolean,
  progress: number,
  labels: SettingsMessages,
) {
  if (requestFailed || !state) return labels.updateStatusFailed;
  switch (state.phase) {
    case 'IDLE':
      return null;
    case 'CHECKING':
      return labels.checkingForUpdates;
    case 'AVAILABLE':
      return labels.microsoftStoreUpdateAvailable;
    case 'DOWNLOADING':
      return labels.downloadingUpdate(progress);
    case 'READY':
      return labels.updateReady;
    case 'INSTALLING':
      return labels.installingUpdate;
    case 'RESTART_REQUIRED':
      return labels.updateInstalledRestartRequired;
    case 'UP_TO_DATE':
      return labels.upToDate;
    case 'UNSUPPORTED':
      return null;
    case 'ERROR':
      if (state.error?.action === 'DOWNLOAD') return labels.updateDownloadFailed;
      if (state.error?.action === 'INSTALL') return labels.updateInstallFailed;
      return labels.updateCheckFailed;
  }
}

function actionForState(
  state: AppUpdateStateDto | null,
  requestFailed: boolean,
  labels: SettingsMessages,
): UpdateAction | null {
  if (requestFailed) {
    return { label: labels.retryUpdate, run: () => window.desktopApi.appUpdateGetState(), icon: RefreshCwIcon };
  }
  if (!state) return null;
  if (state.phase === 'IDLE' || state.phase === 'UP_TO_DATE') {
    return { label: labels.checkForUpdates, run: () => window.desktopApi.appUpdateCheck(), icon: RefreshCwIcon };
  }
  if (state.phase === 'AVAILABLE') {
    return { label: labels.downloadUpdate, run: () => window.desktopApi.appUpdateDownload(), icon: DownloadIcon };
  }
  if (state.phase === 'READY') {
    return { label: labels.restartAndUpdate, run: () => window.desktopApi.appUpdateInstall(), icon: RefreshCwIcon };
  }
  if (state.phase === 'RESTART_REQUIRED') {
    return {
      label: labels.restartToFinishUpdate,
      run: () => window.desktopApi.appUpdateInstall(),
      icon: RefreshCwIcon,
    };
  }
  if (state.phase !== 'ERROR' || !state.error?.retryable) return null;
  if (state.error.action === 'DOWNLOAD') {
    return { label: labels.retryUpdate, run: () => window.desktopApi.appUpdateDownload(), icon: RefreshCwIcon };
  }
  if (state.error.action === 'INSTALL') {
    return { label: labels.retryUpdate, run: () => window.desktopApi.appUpdateInstall(), icon: RefreshCwIcon };
  }
  return { label: labels.retryUpdate, run: () => window.desktopApi.appUpdateCheck(), icon: RefreshCwIcon };
}

export function AppUpdateSection({ active }: Props) {
  const { messages } = useI18n();
  const l = messages.app.settings;
  const [state, setState] = useState<AppUpdateStateDto | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let eventReceived = false;
    setRequestPending(true);
    setRequestFailed(false);
    const unsubscribe = window.desktopApi.onAppUpdateChanged((next) => {
      if (disposed) return;
      eventReceived = true;
      setRequestFailed(false);
      setState(next);
    });
    void window.desktopApi
      .appUpdateGetState()
      .then((next) => {
        if (!disposed && !eventReceived) setState(next);
      })
      .catch(() => {
        if (!disposed) setRequestFailed(true);
      })
      .finally(() => {
        if (!disposed) setRequestPending(false);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [active]);

  const run = async (operation: () => Promise<AppUpdateStateDto>) => {
    setRequestPending(true);
    setRequestFailed(false);
    try {
      setState(await operation());
    } catch {
      setRequestFailed(true);
    } finally {
      setRequestPending(false);
    }
  };

  if ((!state && !requestFailed) || state?.phase === 'UNSUPPORTED') return null;

  const phase = state?.phase;
  const busy = requestPending || (phase ? busyPhases.has(phase) : false);
  const progress = Math.round(state?.progress?.percent ?? 0);
  const status = statusForState(state, requestFailed, progress, l);
  const action = actionForState(state, requestFailed, l);

  const ActionIcon = action?.icon;
  const needsAttention = requestFailed || (phase ? attentionPhases.has(phase) : false);
  return (
    <div className={needsAttention ? 'grid gap-2 rounded-md border bg-background p-3' : 'grid gap-2 px-1.5'}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p
          className={needsAttention ? 'min-w-0 text-xs text-foreground' : 'min-w-0 text-xs text-muted-foreground'}
          aria-live="polite"
        >
          <span className="tabular-nums">
            {l.currentVersion}: {state?.currentVersion ?? '—'}
            {state?.targetVersion && state.targetVersion !== state.currentVersion ? ` → ${state.targetVersion}` : ''}
          </span>
          {status && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{status}</span>
            </>
          )}
        </p>
        {action && ActionIcon && (
          <Button
            type="button"
            variant={needsAttention ? 'outline' : 'ghost'}
            size="sm"
            className={needsAttention ? undefined : 'px-2 text-muted-foreground'}
            disabled={busy}
            onClick={() => void run(action.run)}
          >
            {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ActionIcon className="size-4" />}
            {action.label}
          </Button>
        )}
      </div>
      {phase === 'DOWNLOADING' && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-label={l.downloadingUpdate(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span
            className="block h-full rounded-full bg-selected-foreground transition-[width] duration-base"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
