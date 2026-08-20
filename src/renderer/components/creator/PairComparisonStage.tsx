import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { GripVerticalIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import type {
  PairComparisonItem,
  PairComparisonMode,
  PairComparisonSlot,
} from '@/renderer/components/creator/PairComparisonView';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';

export interface PairComparisonPan {
  x: number;
  y: number;
}

interface Props {
  a: PairComparisonItem;
  b: PairComparisonItem;
  mode: PairComparisonMode;
  soloSlot: PairComparisonSlot | null;
  splitPosition: number;
  overlayMix: number;
  zoom: number;
  pan: PairComparisonPan;
  labels: { a: string; b: string; swipePosition: string };
  onPanChange(pan: PairComparisonPan): void;
  onSplitPositionChange(position: number): void;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ImageLayer({
  slotLabel,
  source,
  zoom,
  pan,
  opacity = 1,
  clipStart,
}: {
  slotLabel: string;
  source: PairComparisonItem;
  zoom: number;
  pan: PairComparisonPan;
  opacity?: number;
  clipStart?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
      style={clipStart === undefined ? undefined : { clipPath: `inset(0 0 0 ${clipStart}%)` }}
    >
      <img
        key={source.id}
        className="block h-auto max-h-full w-auto max-w-full object-contain outline outline-1 outline-border/70 transition-[transform,opacity] duration-fast select-none"
        src={source.mediaUrl}
        alt={`${slotLabel} · ${source.promptLabel} · ${source.modelLabel} · ${source.repeatLabel}`}
        draggable={false}
        style={{ opacity, transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
      />
    </div>
  );
}

function SlotBadge({ slotLabel, side = 'left' }: { slotLabel: string; side?: 'left' | 'right' }) {
  return (
    <span
      className={cn(
        'absolute top-2 z-20 flex size-6 items-center justify-center rounded-sm border bg-overlay/90 text-xs font-semibold',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      {slotLabel}
    </span>
  );
}

function SingleCanvas({
  slotLabel,
  source,
  zoom,
  pan,
}: {
  slotLabel: string;
  source: PairComparisonItem;
  zoom: number;
  pan: PairComparisonPan;
}) {
  return (
    <div
      data-comparison-canvas
      className="relative isolate size-full min-h-0 min-w-0 overflow-hidden border bg-surface-sunken"
    >
      <ImageAmbientBackdrop src={source.mediaUrl} />
      <ImageLayer slotLabel={slotLabel} source={source} zoom={zoom} pan={pan} />
      <SlotBadge slotLabel={slotLabel} />
    </div>
  );
}

function SwipeDivider({
  stageRef,
  position,
  label,
  onPositionChange,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  position: number;
  label: string;
  onPositionChange(position: number): void;
}) {
  function updateFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    onPositionChange(clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100));
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? 1
          : event.key === 'PageDown'
            ? -10
            : event.key === 'PageUp'
              ? 10
              : null;
    if (delta !== null) {
      event.preventDefault();
      onPositionChange(clamp(position + delta, 0, 100));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onPositionChange(event.key === 'Home' ? 0 : 100);
    }
  }

  return (
    <div
      data-swipe-divider
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${Math.round(position)}%`}
      className="group absolute inset-y-0 z-30 w-6 -translate-x-1/2 cursor-col-resize touch-none outline-none"
      style={{ left: `${position}%` }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onPositionChange(50);
      }}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground/80 outline outline-1 outline-background/80"
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 grid h-10 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-overlay/95 text-foreground ring-ring/40 group-focus-visible:ring-4"
      >
        <GripVerticalIcon className="size-3.5" />
      </span>
    </div>
  );
}

export function PairComparisonStage({
  a,
  b,
  mode,
  soloSlot,
  splitPosition,
  overlayMix,
  zoom,
  pan,
  labels,
  onPanChange,
  onSplitPositionChange,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerX: number; pointerY: number; pan: PairComparisonPan } | null>(null);
  const [dragging, setDragging] = useState(false);

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const canvasWidth = mode === 'SIDE_BY_SIDE' && !soloSlot ? bounds.width / 2 : bounds.width;
    const maxX = Math.max(0, (canvasWidth * (zoom - 1)) / 2);
    const maxY = Math.max(0, (bounds.height * (zoom - 1)) / 2);
    onPanChange({
      x: clamp(drag.current.pan.x + event.clientX - drag.current.pointerX, -maxX, maxX),
      y: clamp(drag.current.pan.y + event.clientY - drag.current.pointerY, -maxY, maxY),
    });
  }

  function finishPan(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const slotLabel = soloSlot === 'B' ? labels.b : labels.a;
  const soloSource = soloSlot === 'B' ? b : a;

  return (
    <div
      ref={stageRef}
      data-pair-comparison-stage
      className={cn(
        'relative size-full min-h-0 overflow-hidden',
        zoom > 1 && (dragging ? 'cursor-grabbing touch-none' : 'cursor-grab touch-none'),
      )}
      onPointerDown={(event) => {
        if (zoom <= 1 || event.button !== 0) return;
        drag.current = { pointerX: event.clientX, pointerY: event.clientY, pan };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={movePan}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
    >
      {soloSlot && <SingleCanvas slotLabel={slotLabel} source={soloSource} zoom={zoom} pan={pan} />}
      {!soloSlot && mode === 'SIDE_BY_SIDE' && (
        <div className="grid size-full min-h-0 grid-cols-2 gap-2">
          <SingleCanvas slotLabel={labels.a} source={a} zoom={zoom} pan={pan} />
          <SingleCanvas slotLabel={labels.b} source={b} zoom={zoom} pan={pan} />
        </div>
      )}
      {!soloSlot && mode === 'SWIPE' && (
        <div
          data-comparison-canvas
          className="relative isolate size-full min-h-0 overflow-hidden border bg-surface-sunken"
        >
          <ImageAmbientBackdrop src={a.mediaUrl} />
          <ImageAmbientBackdrop src={b.mediaUrl} style={{ clipPath: `inset(0 0 0 ${splitPosition}%)` }} />
          <ImageLayer slotLabel={labels.a} source={a} zoom={zoom} pan={pan} />
          <ImageLayer slotLabel={labels.b} source={b} zoom={zoom} pan={pan} clipStart={splitPosition} />
          <SlotBadge slotLabel={labels.a} />
          <SlotBadge slotLabel={labels.b} side="right" />
          <SwipeDivider
            stageRef={stageRef}
            position={splitPosition}
            label={labels.swipePosition}
            onPositionChange={onSplitPositionChange}
          />
        </div>
      )}
      {!soloSlot && mode === 'OVERLAY' && (
        <div
          data-comparison-canvas
          className="relative isolate size-full min-h-0 overflow-hidden border bg-surface-sunken"
        >
          <ImageAmbientBackdrop src={a.mediaUrl} />
          <ImageAmbientBackdrop src={b.mediaUrl} style={{ opacity: overlayMix / 100 }} />
          <ImageLayer slotLabel={labels.a} source={a} zoom={zoom} pan={pan} />
          <ImageLayer slotLabel={labels.b} source={b} zoom={zoom} pan={pan} opacity={overlayMix / 100} />
          <SlotBadge slotLabel={labels.a} />
          <SlotBadge slotLabel={labels.b} side="right" />
        </div>
      )}
    </div>
  );
}
