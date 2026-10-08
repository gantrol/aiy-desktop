import { useEffect, useState } from 'react';
import { DownloadIcon, RefreshCwIcon, type LucideIcon } from 'lucide-react';
import type { AppUpdateStateDto } from '@/shared/contracts/app-update';
import { useI18n } from '@/renderer/i18n/useI18n';

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

export function useAppUpdate(active: boolean) {
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
        if (!disposed && !eventReceived) setRequestFailed(true);
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

  const phase = state?.phase;
  const busy = requestPending || (phase ? busyPhases.has(phase) : false);
  const progress = Math.round(state?.progress?.percent ?? 0);
  const status = statusForState(state, requestFailed, progress, l);
  const action = actionForState(state, requestFailed, l);

  const needsAttention = requestFailed || (phase ? attentionPhases.has(phase) : false);
  return { state, busy, progress, status, action, needsAttention, requestFailed, run };
}
