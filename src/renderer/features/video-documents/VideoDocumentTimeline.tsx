import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/renderer/lib/utils';

export interface VideoDocumentTimelineSegment {
  id: string;
  title: string;
  startTimestampMs: number;
  endTimestampMs: number;
  segmentType?: string;
  confidence?: number;
  startCueSourceIndex?: number | null;
  endCueSourceIndex?: number | null;
}

export interface VideoDocumentTimelineCuePreview {
  startTimestampMs: number;
  endTimestampMs: number;
  text: string;
}

export interface VideoDocumentTimelineViewportRange {
  startTimestampMs: number;
  endTimestampMs: number;
}

export interface VideoDocumentTimelineMarker {
  id: string;
  timestampMs: number;
  title: string;
}

interface Props {
  durationMs: number;
  currentTimeMs: number;
  segments?: readonly VideoDocumentTimelineSegment[];
  cuePreviews?: readonly VideoDocumentTimelineCuePreview[];
  markers?: readonly VideoDocumentTimelineMarker[];
  viewportRange?: VideoDocumentTimelineViewportRange | null;
  activeSegmentId?: string | null;
  ariaLabel?: string;
  openAtLabel(timestamp: string): string;
  onSeek(timestampMs: number): void;
}

const TICK_INTERVALS_MS = [
  5_000,
  10_000,
  15_000,
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
];

const MAXIMUM_VISIBLE_MARKERS = 120;
const MAXIMUM_MARKER_TITLE_CHARACTERS = 240;

function formatTimestamp(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function markerTitle(title: string) {
  return title.length > MAXIMUM_MARKER_TITLE_CHARACTERS
    ? `${title.slice(0, MAXIMUM_MARKER_TITLE_CHARACTERS - 3).trimEnd()}...`
    : title;
}

function ticksFor(durationMs: number) {
  if (durationMs <= 0) return [0];
  const targetInterval = durationMs / 18;
  const interval = TICK_INTERVALS_MS.find((candidate) => candidate >= targetInterval) ?? TICK_INTERVALS_MS.at(-1)!;
  const ticks: number[] = [];
  for (let timestampMs = 0; timestampMs <= durationMs; timestampMs += interval) ticks.push(timestampMs);
  if (ticks.at(-1) !== durationMs) ticks.push(durationMs);
  return ticks;
}

function positionOf(timestampMs: number, durationMs: number) {
  if (durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (timestampMs / durationMs) * 100));
}

function segmentWidth(segment: VideoDocumentTimelineSegment, durationMs: number) {
  if (durationMs <= 0) return 12;
  const share = Math.max(0, segment.endTimestampMs - segment.startTimestampMs) / durationMs;
  return Math.round(Math.min(24, Math.max(9, 9 + share * 50)));
}

function nearestSegment(
  segments: readonly VideoDocumentTimelineSegment[],
  maximumEndTimestampMs: readonly number[],
  timestampMs: number,
  durationMs: number,
) {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (segments[middle]!.startTimestampMs <= timestampMs) low = middle + 1;
    else high = middle;
  }

  const previousIndex = low - 1;
  if (previousIndex >= 0 && maximumEndTimestampMs[previousIndex]! >= timestampMs) {
    let containingLow = 0;
    let containingHigh = previousIndex;
    while (containingLow < containingHigh) {
      const middle = Math.floor((containingLow + containingHigh) / 2);
      if (maximumEndTimestampMs[middle]! >= timestampMs) containingHigh = middle;
      else containingLow = middle + 1;
    }
    return segments[containingLow]!;
  }

  const previous = segments[previousIndex];
  const next = segments[low];
  const nearest =
    !previous ||
    (next && Math.abs(next.startTimestampMs - timestampMs) < Math.abs(previous.startTimestampMs - timestampMs))
      ? next
      : previous;
  return nearest && Math.abs(nearest.startTimestampMs - timestampMs) <= Math.max(4_000, durationMs * 0.025)
    ? nearest
    : null;
}

function cueAtTimestamp(cues: readonly VideoDocumentTimelineCuePreview[], timestampMs: number) {
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

function nearestMarker(markers: readonly VideoDocumentTimelineMarker[], timestampMs: number, durationMs: number) {
  let low = 0;
  let high = markers.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (markers[middle]!.timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }

  const previous = markers[low - 1];
  const next = markers[low];
  const nearest =
    !previous || (next && next.timestampMs - timestampMs < timestampMs - previous.timestampMs) ? next : previous;
  return nearest && Math.abs(nearest.timestampMs - timestampMs) <= Math.max(2_000, durationMs * 0.0125)
    ? nearest
    : null;
}

function visibleMarkers(markers: readonly VideoDocumentTimelineMarker[]) {
  if (markers.length <= MAXIMUM_VISIBLE_MARKERS) return markers;
  return Array.from({ length: MAXIMUM_VISIBLE_MARKERS }, (_, index) => {
    const start = Math.floor((index * markers.length) / MAXIMUM_VISIBLE_MARKERS);
    const end = Math.floor(((index + 1) * markers.length) / MAXIMUM_VISIBLE_MARKERS);
    return markers[Math.floor((start + end - 1) / 2)]!;
  });
}

interface TimelineEntryProps {
  durationMs: number;
  openAtLabel(timestamp: string): string;
  onSeek(timestampMs: number): void;
  onHover(timestampMs: number): void;
  onBlur(): void;
}

const TimelineSegments = memo(function TimelineSegments({
  segments,
  activeSegmentId,
  durationMs,
  openAtLabel,
  onSeek,
  onHover,
  onBlur,
}: TimelineEntryProps & {
  segments: readonly VideoDocumentTimelineSegment[];
  activeSegmentId?: string | null;
}) {
  return segments.map((segment) => {
    const active = segment.id === activeSegmentId;
    return (
      <button
        key={segment.id}
        type="button"
        className="group absolute left-0 z-10 flex h-6 w-8 -translate-y-1/2 items-center justify-start rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ top: `${positionOf(segment.startTimestampMs, durationMs)}%` }}
        aria-label={`${segment.title}, ${openAtLabel(formatTimestamp(segment.startTimestampMs))}`}
        aria-current={active ? 'true' : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onSeek(segment.startTimestampMs);
        }}
        onFocus={() => onHover(segment.startTimestampMs)}
        onBlur={onBlur}
      >
        <span
          className={cn(
            'h-0.5 bg-selected-foreground/45 transition-[width,background-color] duration-200 group-hover:bg-selected-foreground group-focus-visible:bg-selected-foreground',
            active && 'h-[3px] bg-selected-foreground',
          )}
          style={{ width: segmentWidth(segment, durationMs) }}
          aria-hidden="true"
        />
      </button>
    );
  });
});

const TimelineMarkers = memo(function TimelineMarkers({
  markers,
  durationMs,
  openAtLabel,
  onSeek,
  onHover,
  onBlur,
}: TimelineEntryProps & {
  markers: readonly VideoDocumentTimelineMarker[];
}) {
  return markers.map((marker) => (
    <button
      key={marker.id}
      type="button"
      className="group absolute left-[5px] z-[15] grid size-[7px] -translate-y-1/2 rotate-45 place-items-center bg-selected-foreground/65 outline-none transition-colors hover:bg-selected-foreground focus-visible:ring-2 focus-visible:ring-ring"
      style={{ top: `${positionOf(marker.timestampMs, durationMs)}%` }}
      aria-label={`${markerTitle(marker.title)}, ${openAtLabel(formatTimestamp(marker.timestampMs))}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSeek(marker.timestampMs);
      }}
      onFocus={() => onHover(marker.timestampMs)}
      onBlur={onBlur}
    />
  ));
});

function useOrderedTimelineEntries(
  segments: readonly VideoDocumentTimelineSegment[],
  cuePreviews: readonly VideoDocumentTimelineCuePreview[],
  markers: readonly VideoDocumentTimelineMarker[],
) {
  const orderedSegments = useMemo(
    () =>
      [...segments].sort(
        (left, right) =>
          left.startTimestampMs - right.startTimestampMs ||
          left.endTimestampMs - right.endTimestampMs ||
          left.id.localeCompare(right.id),
      ),
    [segments],
  );
  const maximumSegmentEndTimestamps = useMemo(() => {
    let maximum = 0;
    return orderedSegments.map((segment) => (maximum = Math.max(maximum, segment.endTimestampMs)));
  }, [orderedSegments]);
  const orderedMarkers = useMemo(
    () => [...markers].sort((left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id)),
    [markers],
  );
  const renderedMarkers = useMemo(() => visibleMarkers(orderedMarkers), [orderedMarkers]);
  return {
    maximumSegmentEndTimestamps,
    orderedCuePreviews: cuePreviews,
    orderedMarkers,
    orderedSegments,
    renderedMarkers,
  };
}

export function VideoDocumentTimeline({
  durationMs,
  currentTimeMs,
  segments = [],
  cuePreviews = [],
  markers = [],
  viewportRange,
  activeSegmentId,
  ariaLabel,
  openAtLabel,
  onSeek,
}: Props) {
  const normalizedDurationMs = Math.max(0, durationMs);
  const ticks = useMemo(() => ticksFor(normalizedDurationMs), [normalizedDurationMs]);
  const { maximumSegmentEndTimestamps, orderedCuePreviews, orderedMarkers, orderedSegments, renderedMarkers } =
    useOrderedTimelineEntries(segments, cuePreviews, markers);
  const [hoverTimestampMs, setHoverTimestampMs] = useState<number | null>(null);
  const [hoverDetailsVisible, setHoverDetailsVisible] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointerTimestampRef = useRef<number | null>(null);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const seek = useCallback((timestampMs: number) => onSeekRef.current(timestampMs), []);
  const nearbySegment = useMemo(
    () =>
      hoverTimestampMs === null
        ? null
        : nearestSegment(orderedSegments, maximumSegmentEndTimestamps, hoverTimestampMs, normalizedDurationMs),
    [hoverTimestampMs, maximumSegmentEndTimestamps, normalizedDurationMs, orderedSegments],
  );
  const nearbyCue = useMemo(
    () => (hoverTimestampMs === null ? null : cueAtTimestamp(orderedCuePreviews, hoverTimestampMs)),
    [hoverTimestampMs, orderedCuePreviews],
  );
  const nearbyMarker = useMemo(
    () => (hoverTimestampMs === null ? null : nearestMarker(orderedMarkers, hoverTimestampMs, normalizedDurationMs)),
    [hoverTimestampMs, normalizedDurationMs, orderedMarkers],
  );

  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
      if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
    },
    [],
  );

  function commitPendingPointerTimestamp() {
    const timestampMs = pendingPointerTimestampRef.current;
    pendingPointerTimestampRef.current = null;
    if (timestampMs === null) return;
    setHoverTimestampMs(timestampMs);
    if (scrubbingRef.current) seek(timestampMs);
  }

  const cancelPointerFrame = useCallback(() => {
    if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = null;
    pendingPointerTimestampRef.current = null;
  }, []);

  function flushPointerFrame() {
    if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = null;
    commitPendingPointerTimestamp();
  }

  function schedulePointerTimestamp(timestampMs: number) {
    pendingPointerTimestampRef.current = timestampMs;
    if (pointerFrameRef.current !== null) return;
    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      commitPendingPointerTimestamp();
    });
  }

  function seekFromRail(clientY: number, rail: HTMLElement) {
    const bounds = rail.getBoundingClientRect();
    if (bounds.height <= 0 || normalizedDurationMs <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height));
    seek(Math.round(normalizedDurationMs * ratio));
  }

  function timestampFromPointer(clientY: number, rail: HTMLElement) {
    const bounds = rail.getBoundingClientRect();
    if (bounds.height <= 0 || normalizedDurationMs <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height));
    return Math.round(normalizedDurationMs * ratio);
  }

  function beginHover() {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHoverDetailsVisible(true), 450);
  }

  const endHover = useCallback(() => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    cancelPointerFrame();
    setHoverTimestampMs(null);
    setHoverDetailsVisible(false);
  }, [cancelPointerFrame]);

  const showEntryDetails = useCallback((timestampMs: number) => {
    setHoverTimestampMs(timestampMs);
    setHoverDetailsVisible(true);
  }, []);

  return (
    <nav
      data-slot="video-document-timeline"
      aria-label={ariaLabel}
      className="group/timeline sticky top-4 z-30 h-[min(70vh,42rem)] w-8 cursor-pointer select-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        scrubbingRef.current = true;
        setScrubbing(true);
        seekFromRail(event.clientY, event.currentTarget);
      }}
      onPointerEnter={beginHover}
      onPointerMove={(event) => {
        const timestampMs = timestampFromPointer(event.clientY, event.currentTarget);
        schedulePointerTimestamp(timestampMs);
      }}
      onPointerUp={(event) => {
        if (!scrubbingRef.current) return;
        pendingPointerTimestampRef.current = timestampFromPointer(event.clientY, event.currentTarget);
        flushPointerFrame();
        scrubbingRef.current = false;
        setScrubbing(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        cancelPointerFrame();
        scrubbingRef.current = false;
        setScrubbing(false);
      }}
      onPointerLeave={endHover}
    >
      <span className="absolute bottom-0 left-2 top-0 w-px bg-border/60" aria-hidden="true" />
      {viewportRange && (
        <span
          className="absolute left-[6px] z-[1] w-1 bg-selected-foreground/25"
          style={{
            top: `${positionOf(viewportRange.startTimestampMs, normalizedDurationMs)}%`,
            height: `${Math.max(
              1.5,
              positionOf(viewportRange.endTimestampMs, normalizedDurationMs) -
                positionOf(viewportRange.startTimestampMs, normalizedDurationMs),
            )}%`,
          }}
          aria-hidden="true"
        />
      )}
      <span
        className="absolute left-2 top-0 w-px bg-gradient-to-b from-selected-foreground/35 via-selected-foreground/65 to-selected-foreground transition-[height] duration-200 ease-out"
        style={{ height: `${positionOf(currentTimeMs, normalizedDurationMs)}%` }}
        aria-hidden="true"
      />
      {ticks.map((timestampMs, index) => (
        <span
          key={timestampMs}
          className="absolute left-2 h-px -translate-y-1/2 bg-border-strong/70 transition-[width,background-color] duration-200 group-hover/timeline:bg-selected-foreground/30"
          style={{
            top: `${positionOf(timestampMs, normalizedDurationMs)}%`,
            width: index % 3 === 0 ? 10 : 6,
          }}
          aria-hidden="true"
        />
      ))}
      <TimelineSegments
        segments={orderedSegments}
        activeSegmentId={activeSegmentId}
        durationMs={normalizedDurationMs}
        openAtLabel={openAtLabel}
        onSeek={seek}
        onHover={showEntryDetails}
        onBlur={endHover}
      />
      <TimelineMarkers
        markers={renderedMarkers}
        durationMs={normalizedDurationMs}
        openAtLabel={openAtLabel}
        onSeek={seek}
        onHover={showEntryDetails}
        onBlur={endHover}
      />
      <button
        type="button"
        className={cn(
          'group absolute left-0 z-20 flex h-6 w-8 -translate-y-1/2 items-center justify-start rounded-sm outline-none transition-[top] ease-out focus-visible:ring-2 focus-visible:ring-ring',
          scrubbing ? 'duration-0' : 'duration-200',
        )}
        style={{ top: `${positionOf(currentTimeMs, normalizedDurationMs)}%` }}
        aria-label={openAtLabel(formatTimestamp(currentTimeMs))}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          seek(currentTimeMs);
        }}
        onFocus={() => {
          setHoverTimestampMs(currentTimeMs);
          setHoverDetailsVisible(true);
        }}
        onBlur={endHover}
      >
        <span className="h-[3px] w-7 bg-selected-foreground" aria-hidden="true" />
      </button>
      {hoverTimestampMs !== null && (
        <>
          <span
            className="pointer-events-none absolute left-0 z-30 h-0.5 w-6 -translate-y-1/2 bg-selected-foreground transition-[width] duration-100 ease-out"
            style={{ top: `${positionOf(hoverTimestampMs, normalizedDurationMs)}%` }}
            aria-hidden="true"
          />
          <span
            className={cn(
              'pointer-events-none absolute left-9 z-40 w-64 -translate-y-1/2 rounded-sm border border-selected-border border-l-2 border-l-selected-foreground bg-overlay/95 px-3 py-2 text-left shadow-overlay backdrop-blur-sm transition-[opacity,transform] duration-150 ease-out',
              hoverDetailsVisible ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
            )}
            style={{
              top: `clamp(2.5rem, ${positionOf(hoverTimestampMs, normalizedDurationMs)}%, calc(100% - 2.5rem))`,
            }}
          >
            {(nearbyMarker || nearbySegment) && (
              <strong className="block line-clamp-2 text-sm font-medium text-foreground">
                {nearbyMarker ? markerTitle(nearbyMarker.title) : nearbySegment?.title}
              </strong>
            )}
            <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-selected-foreground">
              {nearbySegment
                ? `${formatTimestamp(hoverTimestampMs)} · ${formatTimestamp(nearbySegment.startTimestampMs)}–${formatTimestamp(nearbySegment.endTimestampMs)}`
                : formatTimestamp(hoverTimestampMs)}
            </span>
            {nearbyCue && (
              <span className="mt-1.5 line-clamp-3 block text-xs leading-5 text-foreground">{nearbyCue.text}</span>
            )}
          </span>
        </>
      )}
    </nav>
  );
}
