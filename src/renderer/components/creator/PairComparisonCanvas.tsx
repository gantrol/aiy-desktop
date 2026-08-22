import type { DragEvent as ReactDragEvent, RefObject } from 'react';
import type { PairComparisonItem } from '@/renderer/components/creator/PairComparisonView';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { cn } from '@/renderer/lib/utils';

interface CanvasPan {
  x: number;
  y: number;
}

export function PairComparisonImageLayer({
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
  pan: CanvasPan;
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

export function PairComparisonSlotBadge({ slotLabel, side = 'left' }: { slotLabel: string; side?: 'left' | 'right' }) {
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

export function PairComparisonSingleCanvas({
  canvasRef,
  slotLabel,
  source,
  zoom,
  pan,
  draggable,
  onDragStart,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  slotLabel: string;
  source: PairComparisonItem;
  zoom: number;
  pan: CanvasPan;
  draggable: boolean;
  onDragStart?(event: ReactDragEvent<HTMLDivElement>): void;
}) {
  return (
    <div
      ref={canvasRef}
      data-comparison-canvas
      data-comparison-slot={slotLabel}
      draggable={draggable}
      className="relative isolate size-full min-h-0 min-w-0 overflow-hidden border bg-surface-sunken"
      onDragStart={onDragStart}
    >
      <ImageAmbientBackdrop src={source.mediaUrl} />
      <PairComparisonImageLayer slotLabel={slotLabel} source={source} zoom={zoom} pan={pan} />
      <PairComparisonSlotBadge slotLabel={slotLabel} />
    </div>
  );
}
