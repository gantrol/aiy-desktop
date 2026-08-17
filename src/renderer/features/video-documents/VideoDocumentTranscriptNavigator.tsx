import { TextIcon, VideoIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { VideoDocumentTranscriptCue } from '@/shared/contracts';
import type { VideoDocumentTranscriptViewportRange } from '@/renderer/features/video-documents/useVideoDocumentTranscriptViewport';
import { cn } from '@/renderer/lib/utils';

interface Props {
  ariaLabel?: string;
  cues: readonly VideoDocumentTranscriptCue[];
  currentTimeMs: number;
  durationMs: number;
  focusedCue: VideoDocumentTranscriptCue | null;
  textFocusLabel(timestamp: string): string;
  videoPositionLabel(timestamp: string): string;
  viewportRange: VideoDocumentTranscriptViewportRange | null;
  onMove(timestampMs: number): void;
}

const MINIMUM_VIEWPORT_PERCENT = 6;

function clampTimestamp(timestampMs: number, durationMs: number) {
  return Math.min(durationMs, Math.max(0, timestampMs));
}

function formatTimestamp(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function positionOf(timestampMs: number, durationMs: number) {
  if (durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (timestampMs / durationMs) * 100));
}

function viewportGeometry(range: VideoDocumentTranscriptViewportRange, durationMs: number) {
  const start = positionOf(range.startTimestampMs, durationMs);
  const end = positionOf(range.endTimestampMs, durationMs);
  const height = Math.min(100, Math.max(MINIMUM_VIEWPORT_PERCENT, end - start));
  return {
    height: `${height}%`,
    top: `${Math.min(start, 100 - height)}%`,
  };
}

function timestampFromPointer(clientY: number, rail: HTMLElement, durationMs: number) {
  const bounds = rail.getBoundingClientRect();
  if (bounds.height <= 0 || durationMs <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height));
  return Math.round(durationMs * ratio);
}

function cueAtTimestamp(cues: readonly VideoDocumentTranscriptCue[], timestampMs: number) {
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle]!;
    if (timestampMs < cue.startTimestampMs) high = middle - 1;
    else if (timestampMs > cue.endTimestampMs) low = middle + 1;
    else return cue;
  }
  const previous = cues[Math.max(0, high)];
  const next = cues[Math.min(cues.length - 1, low)];
  if (!previous) return next ?? null;
  if (!next) return previous;
  return timestampMs - previous.endTimestampMs <= next.startTimestampMs - timestampMs ? previous : next;
}

export function VideoDocumentTranscriptNavigator({
  ariaLabel,
  cues,
  currentTimeMs,
  durationMs,
  focusedCue,
  textFocusLabel,
  videoPositionLabel,
  viewportRange,
  onMove,
}: Props) {
  const normalizedDurationMs = Math.max(0, durationMs);
  const orderedCues = useMemo(
    () =>
      [...cues].sort(
        (left, right) =>
          left.startTimestampMs - right.startTimestampMs ||
          left.endTimestampMs - right.endTimestampMs ||
          left.sourceIndex - right.sourceIndex,
      ),
    [cues],
  );
  const [dragging, setDragging] = useState(false);
  const [hoverTimestampMs, setHoverTimestampMs] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetMsRef = useRef(0);
  const pendingPointerTimestampMsRef = useRef<number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const hoveredCue = useMemo(
    () => (hoverTimestampMs === null ? null : cueAtTimestamp(orderedCues, hoverTimestampMs)),
    [hoverTimestampMs, orderedCues],
  );

  useEffect(
    () => () => {
      if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
    },
    [],
  );

  function commitPendingPointer() {
    const timestampMs = pendingPointerTimestampMsRef.current;
    pendingPointerTimestampMsRef.current = null;
    if (timestampMs === null) return;
    setHoverTimestampMs(timestampMs);
    if (draggingRef.current) {
      onMoveRef.current(clampTimestamp(timestampMs - dragOffsetMsRef.current, normalizedDurationMs));
    }
  }

  function schedulePointer(timestampMs: number) {
    pendingPointerTimestampMsRef.current = timestampMs;
    if (pointerFrameRef.current !== null) return;
    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      commitPendingPointer();
    });
  }

  function flushPointer() {
    if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = null;
    commitPendingPointer();
  }

  function schedulePointerFromEvent(event: PointerEvent<HTMLElement>) {
    schedulePointer(timestampFromPointer(event.clientY, event.currentTarget, normalizedDurationMs));
  }

  function beginDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || normalizedDurationMs <= 0) return;
    const pointerTimestampMs = timestampFromPointer(event.clientY, event.currentTarget, normalizedDurationMs);
    const withinViewport =
      viewportRange &&
      pointerTimestampMs >= viewportRange.startTimestampMs &&
      pointerTimestampMs <= viewportRange.endTimestampMs;
    dragOffsetMsRef.current = withinViewport
      ? pointerTimestampMs - (viewportRange.startTimestampMs + viewportRange.endTimestampMs) / 2
      : 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    schedulePointer(pointerTimestampMs);
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (!draggingRef.current) return;
    pendingPointerTimestampMsRef.current = timestampFromPointer(
      event.clientY,
      event.currentTarget,
      normalizedDurationMs,
    );
    flushPointer();
    draggingRef.current = false;
    dragOffsetMsRef.current = 0;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function cancelDrag() {
    if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = null;
    pendingPointerTimestampMsRef.current = null;
    draggingRef.current = false;
    dragOffsetMsRef.current = 0;
    setDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (normalizedDurationMs <= 0) return;
    const viewportCenterMs = viewportRange ? (viewportRange.startTimestampMs + viewportRange.endTimestampMs) / 2 : 0;
    const viewportSpanMs = viewportRange
      ? Math.max(0, viewportRange.endTimestampMs - viewportRange.startTimestampMs)
      : 0;
    const stepMs = Math.max(1_000, viewportSpanMs * 0.5, normalizedDurationMs * 0.025);
    const pageMs = Math.max(stepMs, viewportSpanMs * 0.9, normalizedDurationMs * 0.1);
    let nextTimestampMs: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextTimestampMs = viewportCenterMs - stepMs;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextTimestampMs = viewportCenterMs + stepMs;
    if (event.key === 'PageUp') nextTimestampMs = viewportCenterMs - pageMs;
    if (event.key === 'PageDown') nextTimestampMs = viewportCenterMs + pageMs;
    if (event.key === 'Home') nextTimestampMs = 0;
    if (event.key === 'End') nextTimestampMs = normalizedDurationMs;
    if (nextTimestampMs === null) return;
    event.preventDefault();
    onMoveRef.current(clampTimestamp(nextTimestampMs, normalizedDurationMs));
  }

  const viewportCenterMs = viewportRange
    ? Math.round((viewportRange.startTimestampMs + viewportRange.endTimestampMs) / 2)
    : 0;

  return (
    <div
      data-slot="video-document-transcript-navigator"
      role="slider"
      aria-label={ariaLabel}
      aria-controls="video-document-transcript-cues"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={normalizedDurationMs}
      aria-valuenow={viewportCenterMs}
      aria-valuetext={
        viewportRange
          ? `${formatTimestamp(viewportRange.startTimestampMs)}–${formatTimestamp(viewportRange.endTimestampMs)}`
          : formatTimestamp(viewportCenterMs)
      }
      tabIndex={normalizedDurationMs > 0 ? 0 : -1}
      className={cn(
        'group/transcript-navigator sticky top-4 z-30 h-[min(70vh,42rem)] w-8 touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        normalizedDurationMs > 0 && 'cursor-ns-resize',
      )}
      onKeyDown={handleKeyDown}
      onPointerDown={beginDrag}
      onPointerEnter={schedulePointerFromEvent}
      onPointerMove={schedulePointerFromEvent}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onPointerLeave={() => {
        if (draggingRef.current) return;
        if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
        pendingPointerTimestampMsRef.current = null;
        setHoverTimestampMs(null);
      }}
    >
      <span
        className="pointer-events-none absolute inset-y-0 left-[15px] w-0.5 rounded-full bg-gradient-to-b from-border/35 via-border/70 to-border/35 transition-colors duration-200 group-hover/transcript-navigator:via-border-strong/70"
        aria-hidden="true"
      />
      {viewportRange && (
        <span
          className="pointer-events-none absolute left-[10px] z-10 w-3"
          style={viewportGeometry(viewportRange, normalizedDurationMs)}
          aria-hidden="true"
        >
          <span
            className={cn(
              'absolute inset-y-1 inset-x-0 rounded-full border-x border-selected-border/30 bg-selected/10 transition-[background-color,border-color] duration-150',
              dragging
                ? 'border-selected-border/70 bg-selected/30'
                : 'group-hover/transcript-navigator:border-selected-border/50 group-hover/transcript-navigator:bg-selected/20',
            )}
          />
          <span
            className={cn(
              'absolute inset-x-0 top-0 h-1 rounded-full bg-selected-foreground/55 shadow-sm transition-colors duration-150',
              dragging && 'bg-selected-foreground/85',
            )}
          />
          <span
            className={cn(
              'absolute inset-x-0 bottom-0 h-1 rounded-full bg-selected-foreground/55 shadow-sm transition-colors duration-150',
              dragging && 'bg-selected-foreground/85',
            )}
          />
        </span>
      )}
      <span
        role="img"
        aria-label={videoPositionLabel(formatTimestamp(currentTimeMs))}
        className="pointer-events-none absolute left-0 z-20 flex w-4 -translate-y-1/2 items-center text-muted-foreground transition-[top,color] duration-200 ease-out group-hover/transcript-navigator:text-foreground"
        style={{
          top: `clamp(0.5rem, ${positionOf(currentTimeMs, normalizedDurationMs)}%, calc(100% - 0.5rem))`,
        }}
      >
        <VideoIcon className="size-3 shrink-0 drop-shadow-sm" strokeWidth={2} aria-hidden="true" />
        <span className="h-px flex-1 bg-current opacity-45" aria-hidden="true" />
      </span>
      {focusedCue && (
        <span
          role="img"
          aria-label={textFocusLabel(formatTimestamp(focusedCue.startTimestampMs))}
          className="pointer-events-none absolute left-[16px] z-30 flex w-4 -translate-y-1/2 items-center text-selected-foreground transition-[top] duration-200 ease-out"
          style={{
            top: `clamp(0.5rem, ${positionOf(focusedCue.startTimestampMs, normalizedDurationMs)}%, calc(100% - 0.5rem))`,
          }}
        >
          <span className="h-px flex-1 bg-current opacity-55" aria-hidden="true" />
          <TextIcon className="size-3 shrink-0 drop-shadow-sm" strokeWidth={2.25} aria-hidden="true" />
        </span>
      )}
      {hoverTimestampMs !== null && hoveredCue && (
        <>
          <span
            className="pointer-events-none absolute left-[13px] z-40 size-1.5 -translate-y-1/2 rounded-full border border-background bg-foreground shadow-sm"
            style={{ top: `${positionOf(hoverTimestampMs, normalizedDurationMs)}%` }}
            aria-hidden="true"
          />
          <span
            role="tooltip"
            className="pointer-events-none absolute left-10 z-50 w-64 -translate-y-1/2 rounded-md border border-border bg-overlay/95 px-3 py-2 text-left shadow-overlay backdrop-blur-sm"
            style={{
              top: `clamp(2.75rem, ${positionOf(hoverTimestampMs, normalizedDurationMs)}%, calc(100% - 2.75rem))`,
            }}
          >
            <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatTimestamp(hoveredCue.startTimestampMs)}
            </span>
            <span className="mt-1 line-clamp-3 block text-xs leading-5 text-foreground">{hoveredCue.text}</span>
          </span>
        </>
      )}
    </div>
  );
}
