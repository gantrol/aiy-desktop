import { useEffect, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageSearchModelState } from '@/shared/contracts/image-search';
import { ImageSearchDeviceSettings } from '@/renderer/features/content-search/ImageSearchDeviceSettings';

function modelStatus(state: ImageSearchModelState | null) {
  if (state?.ready) return 'modelReady';
  return state?.modelReady && state.runtimeRequired ? 'runtimeMissing' : 'modelMissing';
}

function downloadLabel(state: ImageSearchModelState | null) {
  if (!state?.runtimeRequired) return 'downloadModel';
  return state.modelReady ? 'downloadRuntime' : 'downloadModelAndRuntime';
}

export function ImageSearchModelConfiguration({
  active,
  accessKey = '',
  onConfigured,
}: {
  active: boolean;
  accessKey?: string;
  onConfigured?: () => void;
}) {
  const { messages, locale } = useI18n();
  const copy = messages.imageSearch;
  const [state, setState] = useState<ImageSearchModelState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await window.desktopApi.imageSearch.modelState();
        if (cancelled) return;
        setState(result);
        timer = setTimeout(() => void read(), result.download === 'DOWNLOADING' ? 750 : 1_500);
      } catch {
        if (!cancelled) setError(copy.UNAVAILABLE);
      }
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, accessKey, revision, copy.UNAVAILABLE]);
  const action = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if ((await operation()) === false) return;
      setRevision((value) => value + 1);
      onConfigured?.();
    } catch {
      setError(copy.UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  };
  const downloading = state?.download === 'DOWNLOADING';
  return (
    <div className="grid gap-3">
      <span role="status" className="text-sm">
        {downloading
          ? copy.downloading(
              new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
                state.bytes / Math.max(1, state.total),
              ),
            )
          : copy[modelStatus(state)]}
      </span>
      {state && (
        <ImageSearchDeviceSettings
          state={state}
          disabled={!active || !state.active || busy}
          onChange={(device) => void action(() => window.desktopApi.imageSearch.setDevice(device))}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!active || !state?.active || busy || downloading}
          onClick={() => void action(() => window.desktopApi.imageSearch.configure(locale))}
        >
          {state?.modelReady || state?.ready ? copy.changeModel : copy.selectModel}
        </Button>
        {downloading ? (
          <Button variant="outline" onClick={() => void action(() => window.desktopApi.imageSearch.cancelDownload())}>
            {copy.cancelDownload}
          </Button>
        ) : !state?.ready ? (
          <Button
            variant="outline"
            disabled={!active || !state?.canDownload || busy}
            onClick={() => void action(() => window.desktopApi.imageSearch.downloadModel())}
          >
            {copy[downloadLabel(state)]}
          </Button>
        ) : null}
      </div>
      {state && !state.canDownload && (!state.active || !state.ready) && (
        <p className="text-sm" role="status">
          {state.active ? copy.downloadPermission : copy.DISABLED}
        </p>
      )}
      {(error || state?.download === 'FAILED') && (
        <p role="alert" className="text-sm text-destructive">
          {error || copy.downloadFailed}
        </p>
      )}
    </div>
  );
}
