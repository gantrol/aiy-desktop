import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  ReplaceIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoDocumentFrameCaptureResult, VideoDocumentTimelineSegment } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Slider } from '@/renderer/components/ui/slider';

interface Labels {
  insert: string;
  replace: string;
  time: string;
  capture: string;
  invalidTime: string;
  failed: string;
  stepBack: string;
  stepForward: string;
  preview: string;
}

interface Props {
  documentId: string;
  sourceVideoUrl?: string;
  currentTimeMs: number;
  selectedImageTimestampMs?: number | null;
  durationMs: number;
  timelineSegments?: readonly VideoDocumentTimelineSegment[];
  replacing: boolean;
  labels: Labels;
  onCapture(result: VideoDocumentFrameCaptureResult): void;
}

const FRAME_STEP_MS = 100;

function formatTimestamp(timestampMs: number, precise = false) {
  const safeTimestampMs = Math.max(0, Math.round(timestampMs));
  const totalSeconds = Math.floor(safeTimestampMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = safeTimestampMs % 1_000;
  const prefix =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return precise ? `${prefix}.${String(milliseconds).padStart(3, '0')}` : prefix;
}

function parseTimestamp(value: string) {
  const parts = value.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d{1,3})?$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  const seconds = numbers.reduce((total, number) => total * 60 + number, 0);
  return Math.round(seconds * 1_000);
}

function boundedTimestamp(timestampMs: number, durationMs: number) {
  return Math.min(Math.max(0, Math.round(timestampMs)), Math.max(0, durationMs));
}

export function VideoDocumentFramePicker({
  documentId,
  sourceVideoUrl,
  currentTimeMs,
  selectedImageTimestampMs,
  durationMs,
  timelineSegments = [],
  replacing,
  labels,
  onCapture,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekFrameRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [timestampMs, setTimestampMs] = useState(0);
  const [time, setTime] = useState('00:00.000');
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');

  const selectTimestamp = useCallback(
    (nextTimestampMs: number) => {
      const bounded = boundedTimestamp(nextTimestampMs, durationMs);
      setTimestampMs(bounded);
      setTime(formatTimestamp(bounded, true));
      setError('');
    },
    [durationMs],
  );

  useEffect(() => {
    if (!open) return;
    selectTimestamp(selectedImageTimestampMs ?? currentTimeMs);
  }, [currentTimeMs, open, selectedImageTimestampMs, selectTimestamp]);

  useEffect(() => {
    if (!open || !sourceVideoUrl) return undefined;
    if (seekFrameRef.current !== null) window.cancelAnimationFrame(seekFrameRef.current);
    seekFrameRef.current = window.requestAnimationFrame(() => {
      seekFrameRef.current = null;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      const nextTime = timestampMs / 1_000;
      if (Math.abs(video.currentTime - nextTime) > 0.01) video.currentTime = nextTime;
    });
    return () => {
      if (seekFrameRef.current !== null) window.cancelAnimationFrame(seekFrameRef.current);
      seekFrameRef.current = null;
    };
  }, [open, sourceVideoUrl, timestampMs]);

  function commitTimeInput() {
    const parsed = parseTimestamp(time);
    if (parsed === null || parsed < 0 || parsed > durationMs) {
      setError(labels.invalidTime);
      return false;
    }
    selectTimestamp(parsed);
    return true;
  }

  async function capture() {
    if (!commitTimeInput()) return;
    const parsed = parseTimestamp(time);
    if (parsed === null) return;
    setCapturing(true);
    setError('');
    try {
      const result = await window.desktopApi.videoDocumentFrameCapture({ documentId, timestampMs: parsed });
      onCapture(result);
      setOpen(false);
    } catch {
      setError(labels.failed);
    } finally {
      setCapturing(false);
    }
  }

  const actionLabel = replacing ? labels.replace : labels.insert;
  return (
    <Popover open={open} onOpenChange={(next) => !capturing && setOpen(next)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          title={actionLabel}
          aria-label={actionLabel}
        >
          {replacing ? <ReplaceIcon className="size-3.5" /> : <ImagePlusIcon className="size-3.5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[min(38rem,calc(100vw-2rem))] overflow-hidden p-0">
        <div className="aspect-video w-full overflow-hidden bg-media-surround-dark">
          {sourceVideoUrl ? (
            <video
              ref={videoRef}
              src={sourceVideoUrl}
              className="size-full object-contain"
              muted
              playsInline
              preload="metadata"
              aria-label={labels.preview}
              onLoadedMetadata={() => {
                const video = videoRef.current;
                if (video) video.currentTime = timestampMs / 1_000;
              }}
            />
          ) : (
            <span className="grid size-full place-items-center text-media-checker-a/50" aria-label={labels.preview}>
              <ImageIcon className="size-8" />
            </span>
          )}
        </div>
        <div className="border-t p-3">
          <div className="relative px-1 pt-2">
            <div className="pointer-events-none absolute inset-x-2 top-0 h-2" aria-hidden="true">
              {timelineSegments.map((segment) => (
                <span
                  key={segment.id}
                  className="absolute top-0 h-1.5 w-px bg-selected-foreground/55"
                  style={{ left: `${durationMs > 0 ? (segment.startTimestampMs / durationMs) * 100 : 0}%` }}
                  title={segment.title}
                />
              ))}
            </div>
            <Slider
              min={0}
              max={Math.max(1, durationMs)}
              step={FRAME_STEP_MS}
              value={[timestampMs]}
              disabled={durationMs <= 0}
              aria-label={labels.time}
              aria-valuetext={formatTimestamp(timestampMs, true)}
              onValueChange={(value) => selectTimestamp(value[0] ?? 0)}
            />
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={labels.stepBack}
              aria-label={labels.stepBack}
              onClick={() => selectTimestamp(timestampMs - FRAME_STEP_MS)}
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <Input
              value={time}
              className="h-8 w-28 font-mono text-xs tabular-nums"
              aria-label={labels.time}
              onChange={(event) => setTime(event.target.value)}
              onBlur={commitTimeInput}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTimeInput();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={labels.stepForward}
              aria-label={labels.stepForward}
              onClick={() => selectTimestamp(timestampMs + FRAME_STEP_MS)}
            >
              <ChevronRightIcon className="size-3.5" />
            </Button>
            <Button type="button" size="sm" className="ml-auto h-8" disabled={capturing} onClick={() => void capture()}>
              {capturing ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : labels.capture}
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
