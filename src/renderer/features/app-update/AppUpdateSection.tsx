import { useEffect, useState } from 'react';
import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react';
import type { AppUpdateStateDto } from '@/shared/contracts/app-update';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  active: boolean;
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

  const phase = state?.phase;
  const busy = requestPending || phase === 'CHECKING' || phase === 'DOWNLOADING' || phase === 'INSTALLING';
  const progress = Math.round(state?.progress?.percent ?? 0);
  const status = (() => {
    if (requestFailed) return l.updateStatusFailed;
    if (!state) return l.updateStatusLoading;
    switch (state.phase) {
      case 'UNSUPPORTED':
        if (state.supportReason === 'DEVELOPMENT') return l.updateUnsupportedDevelopment;
        if (state.supportReason === 'PACKAGE_TYPE') return l.updateUnsupportedPackageType;
        if (state.supportReason === 'CONFIGURATION') return l.updateUnsupportedConfiguration;
        if (state.supportReason === 'SIGNATURE') return l.updateUnsupportedSignature;
        return l.updateUnsupportedPlatform;
      case 'IDLE':
        return l.automaticUpdateChecks;
      case 'CHECKING':
        return l.checkingForUpdates;
      case 'AVAILABLE':
        return state.targetVersion ? l.updateAvailable(state.targetVersion) : l.updateAvailableUnknown;
      case 'DOWNLOADING':
        return l.downloadingUpdate(progress);
      case 'READY':
        return state.targetVersion ? l.updateReady(state.targetVersion) : l.updateReadyUnknown;
      case 'INSTALLING':
        return l.installingUpdate;
      case 'UP_TO_DATE':
        return l.upToDate;
      case 'ERROR':
        if (state.error?.action === 'DOWNLOAD') return l.updateDownloadFailed;
        if (state.error?.action === 'INSTALL') return l.updateInstallFailed;
        return l.updateCheckFailed;
    }
  })();

  const action = (() => {
    if (requestFailed) {
      return { label: l.retryUpdate, run: () => window.desktopApi.appUpdateGetState(), icon: RefreshCwIcon };
    }
    if (!state) return null;
    if (state.phase === 'IDLE' || state.phase === 'UP_TO_DATE') {
      return { label: l.checkForUpdates, run: () => window.desktopApi.appUpdateCheck(), icon: RefreshCwIcon };
    }
    if (state.phase === 'AVAILABLE') {
      return { label: l.downloadUpdate, run: () => window.desktopApi.appUpdateDownload(), icon: DownloadIcon };
    }
    if (state.phase === 'READY') {
      return { label: l.restartAndUpdate, run: () => window.desktopApi.appUpdateInstall(), icon: RefreshCwIcon };
    }
    if (state.phase === 'ERROR') {
      if (!state.error?.retryable) return null;
      if (state.error?.action === 'DOWNLOAD' && state.error.retryable) {
        return { label: l.retryUpdate, run: () => window.desktopApi.appUpdateDownload(), icon: RefreshCwIcon };
      }
      if (state.error?.action === 'INSTALL') {
        return { label: l.retryUpdate, run: () => window.desktopApi.appUpdateInstall(), icon: RefreshCwIcon };
      }
      return { label: l.retryUpdate, run: () => window.desktopApi.appUpdateCheck(), icon: RefreshCwIcon };
    }
    return null;
  })();

  const ActionIcon = action?.icon;
  return (
    <div className="grid gap-2">
      <Label>{l.softwareUpdates}</Label>
      <div className="grid gap-3 rounded-md border bg-background p-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0" aria-live="polite">
            <p className="text-sm text-foreground">{status}</p>
            <MetaText className="mt-0.5 block">
              {l.currentVersion}: {state?.currentVersion ?? '—'}
            </MetaText>
          </div>
          {action && ActionIcon && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(action.run)}>
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
    </div>
  );
}
