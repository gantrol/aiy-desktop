import { LoaderCircleIcon, PauseIcon } from 'lucide-react';
import type { CodexUsageTask } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';

type ScanProgress = NonNullable<CodexUsageTask['progress']>;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

const SCANNING_SHARE_PERCENT = 75;

function scanProgressPercent(progress: ScanProgress) {
  if (progress.phase === 'DISCOVERING') return null;
  if (progress.phase === 'FINALIZING') {
    return clampPercent(SCANNING_SHARE_PERCENT + ((100 - SCANNING_SHARE_PERCENT) * progress.calculationPercent) / 100);
  }
  const fileFraction = progress.filesDiscovered ? progress.filesProcessed / progress.filesDiscovered : null;
  const byteFraction = progress.bytesTotal ? progress.bytesRead / progress.bytesTotal : null;
  const scanningFraction =
    fileFraction !== null && byteFraction !== null
      ? fileFraction * 0.4 + byteFraction * 0.6
      : (fileFraction ?? byteFraction ?? 0);
  return clampPercent(scanningFraction * SCANNING_SHARE_PERCENT);
}

function formatBytes(value: number, formatter: Intl.NumberFormat) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  if (value < 1_000) return `${formatter.format(value)} B`;
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1_000)), units.length - 1);
  return `${formatter.format(value / 1_000 ** unitIndex)} ${units[unitIndex]}`;
}

function formatDuration(value: number, formatter: Intl.NumberFormat) {
  const seconds = Math.max(0, Math.ceil(value / 1_000));
  if (seconds < 60) return `${formatter.format(seconds)}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${formatter.format(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${formatter.format(hours)}h ${formatter.format(remainingMinutes)}m`
    : `${formatter.format(hours)}h`;
}

export function CodexUsageScanProgress({
  progress,
  active,
  phaseLabel,
  backgroundLabel,
  etaLabel,
  elapsedLabel,
  scannedFilesLabel,
  cachedFilesLabel,
  numbers,
}: {
  progress: ScanProgress;
  active: boolean;
  phaseLabel: string;
  backgroundLabel: string;
  etaLabel: string;
  elapsedLabel: string;
  scannedFilesLabel: string;
  cachedFilesLabel: string;
  numbers: Intl.NumberFormat;
}) {
  const percent = scanProgressPercent(progress);
  const roundedPercent = percent === null ? null : Math.round(percent);
  return (
    <div className="grid gap-2 border-y py-3" aria-busy={active}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 font-medium">
          {active ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <PauseIcon className="size-3.5" />}
          {phaseLabel}
          {active && <Badge variant="outline">{backgroundLabel}</Badge>}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {roundedPercent === null ? null : `${numbers.format(roundedPercent)}% · `}
          {progress.phase === 'SCANNING' ? (
            <>
              {progress.filesProcessed}/{progress.filesDiscovered} · {formatBytes(progress.bytesRead, numbers)} /{' '}
              {formatBytes(progress.bytesTotal, numbers)} · {formatBytes(progress.throughputBytesPerSecond, numbers)}/s
              ·{' '}
            </>
          ) : null}
          {etaLabel}{' '}
          {!active || progress.estimatedRemainingMs === null
            ? '—'
            : formatDuration(progress.estimatedRemainingMs, numbers)}
        </span>
      </div>
      <div
        className="h-1 overflow-hidden bg-surface-sunken"
        role="progressbar"
        aria-label={phaseLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent ?? undefined}
        aria-valuetext={roundedPercent === null ? phaseLabel : `${phaseLabel} ${roundedPercent}%`}
      >
        <div
          className={`h-full bg-foreground/65 transition-[width] duration-normal ${percent === null ? 'animate-pulse' : ''}`}
          style={{ width: percent === null ? '33.333%' : `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>
          {progress.filesCached} {cachedFilesLabel} · {progress.filesScanned} {scannedFilesLabel}
        </span>
        <span>
          {elapsedLabel} {formatDuration(progress.elapsedMs, numbers)}
        </span>
      </div>
    </div>
  );
}
