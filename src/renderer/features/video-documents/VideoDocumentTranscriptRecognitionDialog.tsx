import { AudioLinesIcon, InfoIcon, LoaderCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LocalQwenAsrGpuTelemetry,
  LocalQwenAsrSidecarDto,
  VideoDocumentTranscriptBackgroundTaskStatus,
  VideoDocumentTranscriptRecognitionErrorCode,
  VideoDocumentTranscriptRecognitionProgress,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import {
  formatLocalQwenAsrApiPriceCny,
  localQwenAsrApiEquivalentCostCny,
  QWEN3_ASR_FLASH_BEIJING_API_PRICE,
} from '@/renderer/features/video-documents/localQwenAsrApiEquivalentCost';
import { formatVideoDocumentDuration } from '@/renderer/features/video-documents/useVideoDocumentLocalFile';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  hasTranscript: boolean;
  durationMs: number | null;
  recognizing: boolean;
  cancelling: boolean;
  completed: boolean;
  progress: VideoDocumentTranscriptRecognitionProgress | null;
  error: VideoDocumentTranscriptRecognitionErrorCode | null;
  taskStartedAt: string | null;
  taskStatus: VideoDocumentTranscriptBackgroundTaskStatus | null;
  onOpenChange(open: boolean): void;
  onRecognize(): Promise<unknown>;
  onCancel(): Promise<void>;
}

const SIDECAR_POLL_INTERVAL_MS = 2_000;

function recognitionPercent(progress: VideoDocumentTranscriptRecognitionProgress | null) {
  if (!progress?.totalChunks) return null;
  return Math.min(100, Math.round((progress.completedChunks / progress.totalChunks) * 100));
}

function RecognitionProgress({
  progress,
  taskStatus,
}: {
  progress: VideoDocumentTranscriptRecognitionProgress | null;
  taskStatus: VideoDocumentTranscriptBackgroundTaskStatus | null;
}) {
  const labels = useI18n().messages.videoDocuments.transcript.recognition;
  const percent = recognitionPercent(progress);
  const statusLabel =
    taskStatus === 'CANCELLING'
      ? labels.cancelling
      : taskStatus === 'STARTING'
        ? labels.starting
        : percent === null
          ? labels.preparing
          : labels.runningProgress(percent);
  return (
    <div className="grid gap-2" aria-live="polite">
      <div className="flex items-center gap-2 text-sm">
        <LoaderCircleIcon className="size-4 animate-spin" />
        <span>{statusLabel}</span>
        {percent !== null && <span className="ml-auto tabular-nums text-muted-foreground">{percent}%</span>}
      </div>
      {progress && percent !== null && (
        <div
          role="progressbar"
          aria-label={labels.runningProgress(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function RecognitionUsage({ durationMs }: { durationMs: number | null }) {
  const labels = useI18n().messages.videoDocuments.transcript.recognition;
  const apiEquivalentCost = localQwenAsrApiEquivalentCostCny(durationMs);
  if (durationMs === null || apiEquivalentCost === null) return null;
  const unitPrice = formatLocalQwenAsrApiPriceCny(QWEN3_ASR_FLASH_BEIJING_API_PRICE.inputCnyPerSecond);
  return (
    <TooltipProvider delayDuration={320}>
      <dl className="grid grid-cols-2 gap-4 border-t px-4 py-3 text-xs">
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{labels.audioDuration}</dt>
          <dd className="font-medium tabular-nums">{formatVideoDocumentDuration(durationMs)}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="inline-flex items-center gap-1 text-muted-foreground">
            {labels.apiEquivalent}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={labels.apiEquivalentBasis}
                >
                  <InfoIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-96 leading-5">
                {labels.apiEquivalentInfo(
                  QWEN3_ASR_FLASH_BEIJING_API_PRICE.modelId,
                  labels.apiReferenceRegion,
                  unitPrice,
                  QWEN3_ASR_FLASH_BEIJING_API_PRICE.verifiedAt,
                )}
              </TooltipContent>
            </Tooltip>
          </dt>
          <dd className="font-medium tabular-nums">{formatLocalQwenAsrApiPriceCny(apiEquivalentCost)}</dd>
        </div>
      </dl>
    </TooltipProvider>
  );
}

function formatSpeed(speed: number | null) {
  if (speed === null || !Number.isFinite(speed) || speed <= 0) return '—';
  return `${speed.toFixed(speed >= 10 ? 1 : 2)}×`;
}

function formatGpuMemory(telemetry: LocalQwenAsrGpuTelemetry | null) {
  if (!telemetry) return '—';
  return `${(telemetry.memoryUsedMiB / 1_024).toFixed(1)} / ${(telemetry.memoryTotalMiB / 1_024).toFixed(1)} GiB`;
}

function formatGpuEnergy(energyWh: number, available: boolean) {
  if (!available) return '—';
  return `${energyWh.toFixed(energyWh >= 1 ? 2 : 3)} Wh`;
}

function RecognitionRuntimeMetrics({
  durationMs,
  elapsedMs,
  progress,
  telemetry,
  gpuEnergyWh,
  gpuEnergyAvailable,
}: {
  durationMs: number | null;
  elapsedMs: number;
  progress: VideoDocumentTranscriptRecognitionProgress | null;
  telemetry: LocalQwenAsrGpuTelemetry | null;
  gpuEnergyWh: number;
  gpuEnergyAvailable: boolean;
}) {
  const labels = useI18n().messages.videoDocuments.transcript.recognition;
  const processedAudioMs =
    durationMs !== null && progress ? (durationMs * progress.completedChunks) / progress.totalChunks : 0;
  const speed = processedAudioMs > 0 && elapsedMs > 0 ? processedAudioMs / elapsedMs : null;
  return (
    <TooltipProvider delayDuration={320}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border px-4 py-3 text-xs sm:grid-cols-3">
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{labels.elapsedTime}</dt>
          <dd className="font-medium tabular-nums">{formatVideoDocumentDuration(elapsedMs)}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{labels.processingSpeed}</dt>
          <dd className="font-medium tabular-nums">{formatSpeed(speed)}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{labels.gpuUtilization}</dt>
          <dd className="font-medium tabular-nums">
            {telemetry ? `${telemetry.utilizationPercent.toFixed(0)}%` : '—'}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{labels.gpuMemory}</dt>
          <dd className="font-medium tabular-nums">{formatGpuMemory(telemetry)}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">{labels.gpuPower}</dt>
          <dd className="font-medium tabular-nums">
            {telemetry?.powerWatts === null || telemetry?.powerWatts === undefined
              ? '—'
              : `${telemetry.powerWatts.toFixed(1)} W`}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="inline-flex items-center gap-1 text-muted-foreground">
            {labels.gpuEnergy}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={labels.gpuEnergyBasis}
                >
                  <InfoIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-96 leading-5">
                {labels.gpuEnergyInfo}
              </TooltipContent>
            </Tooltip>
          </dt>
          <dd className="font-medium tabular-nums">{formatGpuEnergy(gpuEnergyWh, gpuEnergyAvailable)}</dd>
        </div>
      </dl>
    </TooltipProvider>
  );
}

function ModelStatus({
  sidecar,
  loading,
  durationMs,
}: {
  sidecar: LocalQwenAsrSidecarDto | null;
  loading: boolean;
  durationMs: number | null;
}) {
  const labels = useI18n().messages.videoDocuments.transcript.recognition;
  const status = sidecar?.status ?? 'STOPPED';
  return (
    <section className="rounded-lg border" aria-label={labels.sidecar}>
      <div className="flex items-center gap-2 px-4 py-3">
        <AudioLinesIcon className="size-4" />
        <strong className="text-sm font-medium">{labels.localModel}</strong>
        {loading ? (
          <LoaderCircleIcon className="ml-auto size-4 animate-spin text-muted-foreground" />
        ) : (
          <Badge className="ml-auto" variant={status === 'READY' ? 'default' : 'outline'}>
            {labels.statuses[status]}
          </Badge>
        )}
      </div>
      <RecognitionUsage durationMs={durationMs} />
    </section>
  );
}

interface RecognitionActionsProps {
  hasTranscript: boolean;
  recognizing: boolean;
  cancelling: boolean;
  completed: boolean;
  retrying: boolean;
  unavailable: boolean;
  starting: boolean;
  onClose(): void;
  onRecognize(): void;
  onCancel(): void;
}

function RecognitionActions({
  hasTranscript,
  recognizing,
  cancelling,
  completed,
  retrying,
  unavailable,
  starting,
  onClose,
  onRecognize,
  onCancel,
}: RecognitionActionsProps) {
  const labels = useI18n().messages.videoDocuments.transcript.recognition;
  if (recognizing) {
    return (
      <>
        <Button type="button" variant="outline" onClick={onClose}>
          {labels.runInBackground}
        </Button>
        <Button type="button" variant="outline" disabled={cancelling} onClick={onCancel}>
          {cancelling && <LoaderCircleIcon className="size-4 animate-spin" />}
          {cancelling ? labels.cancelling : labels.cancel}
        </Button>
      </>
    );
  }
  if (completed) {
    return (
      <Button type="button" onClick={onClose}>
        {labels.done}
      </Button>
    );
  }
  return (
    <>
      <Button type="button" variant="outline" onClick={onClose}>
        {labels.close}
      </Button>
      <Button type="button" disabled={unavailable || starting} onClick={onRecognize}>
        {starting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <AudioLinesIcon className="size-4" />}
        {starting ? labels.starting : retrying ? labels.retry : hasTranscript ? labels.recognizeAgain : labels.start}
      </Button>
    </>
  );
}

export function VideoDocumentTranscriptRecognitionDialog({
  open,
  hasTranscript,
  durationMs,
  recognizing,
  cancelling,
  completed,
  progress,
  error,
  taskStartedAt,
  taskStatus,
  onOpenChange,
  onRecognize,
  onCancel,
}: Props) {
  const labels = useI18n().messages.videoDocuments.transcript.recognition;
  const [sidecar, setSidecar] = useState<LocalQwenAsrSidecarDto | null>(null);
  const [loadingSidecar, setLoadingSidecar] = useState(false);
  const [sidecarError, setSidecarError] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [gpuEnergyWh, setGpuEnergyWh] = useState(0);
  const [gpuEnergyAvailable, setGpuEnergyAvailable] = useState(false);
  const recognitionStartedAtRef = useRef<number | null>(null);
  const previousPowerSampleRef = useRef<{ sampledAtMs: number; powerWatts: number } | null>(null);

  const receiveSidecar = useCallback(
    (next: LocalQwenAsrSidecarDto) => {
      setSidecar(next);
      setSidecarError(false);
      const powerWatts = next.telemetry?.powerWatts;
      const sampledAtMs = next.telemetry ? Date.parse(next.telemetry.sampledAt) : Number.NaN;
      if (!recognizing || powerWatts === null || powerWatts === undefined || !Number.isFinite(sampledAtMs)) return;
      const startedAtMs = recognitionStartedAtRef.current;
      if (startedAtMs === null || sampledAtMs < startedAtMs) return;
      const previous = previousPowerSampleRef.current;
      const intervalStartMs = previous?.sampledAtMs ?? startedAtMs;
      const intervalMs = sampledAtMs - intervalStartMs;
      if (intervalMs > 0 && intervalMs <= SIDECAR_POLL_INTERVAL_MS * 3) {
        const averagePowerWatts = previous ? (previous.powerWatts + powerWatts) / 2 : powerWatts;
        setGpuEnergyWh((current) => current + (averagePowerWatts * intervalMs) / 3_600_000);
      }
      previousPowerSampleRef.current = { sampledAtMs, powerWatts };
      setGpuEnergyAvailable(true);
    },
    [recognizing],
  );

  useEffect(() => {
    if (!recognizing) {
      const startedAt = recognitionStartedAtRef.current;
      if (startedAt !== null) setElapsedMs(Date.now() - startedAt);
      return;
    }
    const parsedStartedAt = taskStartedAt ? Date.parse(taskStartedAt) : Number.NaN;
    const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
    recognitionStartedAtRef.current = startedAt;
    previousPowerSampleRef.current = null;
    setElapsedMs(Date.now() - startedAt);
    setGpuEnergyWh(0);
    setGpuEnergyAvailable(false);
  }, [recognizing, taskStartedAt]);

  useEffect(() => {
    if (!open || !recognizing) return undefined;
    const startedAt = recognitionStartedAtRef.current ?? Date.now();
    const updateElapsed = () => setElapsedMs(Date.now() - startedAt);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [open, recognizing]);

  useEffect(() => {
    if (!open || recognizing) return undefined;
    let current = true;
    setLoadingSidecar(true);
    setSidecarError(false);
    void window.desktopApi
      .localQwenAsrSidecarGet()
      .then((next) => {
        if (current) receiveSidecar(next);
      })
      .catch(() => {
        if (current) setSidecarError(true);
      })
      .finally(() => {
        if (current) setLoadingSidecar(false);
      });
    return () => {
      current = false;
    };
  }, [open, receiveSidecar, recognizing]);

  useEffect(() => {
    if (!open || !recognizing) return undefined;
    let current = true;
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const next = await window.desktopApi.localQwenAsrSidecarGet();
        if (current) receiveSidecar(next);
      } catch {
        if (current) setSidecarError(true);
      } finally {
        if (current) timer = window.setTimeout(() => void refresh(), SIDECAR_POLL_INTERVAL_MS);
      }
    };
    void refresh();
    return () => {
      current = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [open, receiveSidecar, recognizing]);

  const status = sidecar?.status ?? 'STOPPED';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {recognizing ? labels.detailsTitle : hasTranscript ? labels.recognizeAgainTitle : labels.title}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <ModelStatus
            sidecar={sidecar}
            loading={loadingSidecar || (recognizing && !sidecar)}
            durationMs={durationMs}
          />
          {(recognizing || completed) && (
            <>
              {recognizing ? (
                <RecognitionProgress progress={progress} taskStatus={taskStatus} />
              ) : (
                <p className="text-sm font-medium text-success" role="status">
                  {labels.completed}
                </p>
              )}
              <RecognitionRuntimeMetrics
                durationMs={durationMs}
                elapsedMs={elapsedMs}
                progress={progress}
                telemetry={sidecar?.telemetry ?? null}
                gpuEnergyWh={gpuEnergyWh}
                gpuEnergyAvailable={gpuEnergyAvailable}
              />
            </>
          )}
          {sidecarError && (
            <p role="alert" className="text-sm text-destructive">
              {labels.sidecarFailed}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {labels.errors[error]}
            </p>
          )}
        </div>

        <DialogFooter>
          <RecognitionActions
            hasTranscript={hasTranscript}
            recognizing={recognizing}
            cancelling={cancelling}
            completed={completed}
            retrying={Boolean(error)}
            unavailable={loadingSidecar || sidecarError || status === 'NOT_INSTALLED'}
            starting={status === 'STARTING'}
            onClose={() => onOpenChange(false)}
            onRecognize={() => {
              setSidecar({
                providerKey: 'qwen-local',
                modelId: 'Qwen/Qwen3-ASR-0.6B',
                status: 'STARTING',
                errorCode: null,
                telemetry: null,
              });
              void onRecognize();
            }}
            onCancel={() => void onCancel()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
