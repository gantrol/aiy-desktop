import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, DragEvent as ReactDragEvent, KeyboardEvent } from 'react';
import {
  ArrowLeftRightIcon,
  BlendIcon,
  Columns2Icon,
  MinusIcon,
  PlusIcon,
  ScanIcon,
  SearchIcon,
  SquareCenterlineDashedVerticalIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Slider } from '@/renderer/components/ui/slider';
import { PairComparisonStage, type PairComparisonPan } from '@/renderer/components/creator/PairComparisonStage';

export type PairComparisonMode = 'SIDE_BY_SIDE' | 'SWIPE' | 'OVERLAY';
export type PairComparisonSlot = 'A' | 'B';

export interface PairComparisonItem {
  id: string;
  assetId: string;
  mediaUrl: string;
  width: number;
  height: number;
  promptLabel: string;
  modelLabel: string;
  repeatLabel: string;
}

export interface PairComparisonLabels {
  sideBySide: string;
  swipe: string;
  swipePosition: string;
  toggle: string;
  overlay: string;
  swap: string;
  zoomOut: string;
  fit: string;
  zoomIn: string;
  magnifier: string;
  close: string;
  opacity: string;
  a: string;
  b: string;
}

export interface PairComparisonViewProps {
  a: PairComparisonItem;
  b: PairComparisonItem;
  onSwap(): void;
  onClose(): void;
  labels: PairComparisonLabels;
  className?: string;
  initialMode?: PairComparisonMode;
  mode?: PairComparisonMode;
  onModeChange?(mode: PairComparisonMode): void;
  onAssetDragStart?(event: ReactDragEvent<HTMLElement>, assetId: string): void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const centeredPan: PairComparisonPan = { x: 0, y: 0 };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function IconButton({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Button type="button" size="icon" aria-label={label} title={label} {...props} />;
}

function SourceSummary({ slotLabel, source }: { slotLabel: string; source: PairComparisonItem }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2.5 py-2 sm:px-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-sm border bg-surface-sunken text-[11px] font-semibold">
        {slotLabel}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-xs font-medium">
          {source.promptLabel} · {source.modelLabel}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {source.repeatLabel} · {source.width} × {source.height}
        </div>
      </div>
    </div>
  );
}

export function PairComparisonView({
  a,
  b,
  onSwap,
  onClose,
  className,
  initialMode = 'SIDE_BY_SIDE',
  mode: controlledMode,
  labels,
  onModeChange,
  onAssetDragStart,
}: PairComparisonViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [localMode, setMode] = useState<PairComparisonMode>(initialMode);
  const mode = controlledMode ?? localMode;
  const [soloSlot, setSoloSlot] = useState<PairComparisonSlot | null>(null);
  const [splitPosition, setSplitPosition] = useState(50);
  const [overlayMix, setOverlayMix] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PairComparisonPan>(centeredPan);
  const [magnifierActive, setMagnifierActive] = useState(false);
  const [magnifierScale, setMagnifierScale] = useState(1);

  useEffect(() => {
    if (controlledMode === undefined) rootRef.current?.focus({ preventScroll: true });
  }, [controlledMode]);

  function changeMode(nextMode: PairComparisonMode) {
    setMode(nextMode);
    setSoloSlot(null);
    onModeChange?.(nextMode);
  }

  function changeZoom(delta: number) {
    const next = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
    setZoom(next);
    if (next <= 1) setPan(centeredPan);
  }

  function fit() {
    setZoom(1);
    setPan(centeredPan);
  }

  function toggleSolo(slot: PairComparisonSlot) {
    setSoloSlot((current) => (current === slot ? null : slot));
  }

  function overlaySliderKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
    event.preventDefault();
    setOverlayMix((current) => clamp(current + (event.key === 'PageUp' ? 10 : -10), 0, 100));
  }

  return (
    <div
      ref={rootRef}
      role="region"
      tabIndex={-1}
      aria-label={`${a.promptLabel} · ${b.promptLabel}`}
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-surface-sunken outline-none', className)}
      data-mode={mode}
    >
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-1.5 border-b bg-background px-2 py-1.5">
        <Segmented
          type="single"
          value={mode}
          onValueChange={(value) => value && changeMode(value as PairComparisonMode)}
          className="h-10 shrink-0"
        >
          <SegmentedItem
            value="SIDE_BY_SIDE"
            aria-label={labels.sideBySide}
            title={labels.sideBySide}
            className="h-9 w-9 px-0"
          >
            <Columns2Icon className="size-4" />
          </SegmentedItem>
          <SegmentedItem value="SWIPE" aria-label={labels.swipe} title={labels.swipe} className="h-9 w-9 px-0">
            <SquareCenterlineDashedVerticalIcon className="size-4" />
          </SegmentedItem>
          <SegmentedItem value="OVERLAY" aria-label={labels.overlay} title={labels.overlay} className="h-9 w-9 px-0">
            <BlendIcon className="size-4" />
          </SegmentedItem>
        </Segmented>

        <div
          role="group"
          aria-label={labels.toggle}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-surface-sunken p-0.5"
        >
          <Button
            type="button"
            variant={soloSlot === 'A' ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={`${labels.toggle}: ${labels.a}`}
            aria-pressed={soloSlot === 'A'}
            onClick={() => toggleSolo('A')}
          >
            {labels.a}
          </Button>
          <Button
            type="button"
            variant={soloSlot === 'B' ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={`${labels.toggle}: ${labels.b}`}
            aria-pressed={soloSlot === 'B'}
            onClick={() => toggleSolo('B')}
          >
            {labels.b}
          </Button>
        </div>

        {mode === 'OVERLAY' && (
          <div
            className="flex min-w-0 flex-1 basis-64 items-center gap-2 px-1 text-[11px] text-muted-foreground"
            title={labels.opacity}
          >
            <span className="w-11 text-right font-mono tabular-nums">
              {labels.a} {100 - overlayMix}%
            </span>
            <div className="relative min-w-24 flex-1">
              <Slider
                value={[overlayMix]}
                min={0}
                max={100}
                step={1}
                aria-label={labels.opacity}
                aria-valuetext={`${labels.a} ${100 - overlayMix}%, ${labels.b} ${overlayMix}%`}
                onDoubleClick={() => setOverlayMix(50)}
                onKeyDown={overlaySliderKeyDown}
                onValueChange={(value) => setOverlayMix(value[0] ?? 50)}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-border-strong"
              />
            </div>
            <span className="w-11 font-mono tabular-nums">
              {overlayMix}% {labels.b}
            </span>
          </div>
        )}

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
          <IconButton
            label={labels.magnifier}
            variant="ghost"
            aria-pressed={magnifierActive}
            className={cn(
              magnifierActive && 'bg-selected text-selected-foreground hover:bg-selected active:bg-selected',
            )}
            onClick={() => setMagnifierActive((current) => !current)}
          >
            <SearchIcon className="size-4" />
          </IconButton>
          <IconButton
            label={labels.zoomOut}
            variant="ghost"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => changeZoom(-ZOOM_STEP)}
          >
            <MinusIcon className="size-4" />
          </IconButton>
          <IconButton label={labels.fit} variant="ghost" onClick={fit}>
            <ScanIcon className="size-4" />
          </IconButton>
          <IconButton
            label={labels.zoomIn}
            variant="ghost"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => changeZoom(ZOOM_STEP)}
          >
            <PlusIcon className="size-4" />
          </IconButton>
          <IconButton label={labels.swap} variant="ghost" onClick={onSwap}>
            <ArrowLeftRightIcon className="size-4" />
          </IconButton>
          <IconButton label={labels.close} variant="ghost" onClick={onClose}>
            <XIcon className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 divide-x border-b bg-background/80">
        <SourceSummary slotLabel={labels.a} source={a} />
        <SourceSummary slotLabel={labels.b} source={b} />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        <PairComparisonStage
          a={a}
          b={b}
          mode={mode}
          soloSlot={soloSlot}
          splitPosition={splitPosition}
          overlayMix={overlayMix}
          zoom={zoom}
          pan={pan}
          magnifierActive={magnifierActive}
          magnifierScale={magnifierScale}
          labels={{
            a: labels.a,
            b: labels.b,
            swipePosition: labels.swipePosition,
            magnifier: labels.magnifier,
            opacity: labels.opacity,
          }}
          onPanChange={setPan}
          onSplitPositionChange={setSplitPosition}
          onOverlayMixChange={setOverlayMix}
          onMagnifierActiveChange={setMagnifierActive}
          onMagnifierScaleChange={setMagnifierScale}
          onAssetDragStart={onAssetDragStart}
        />
      </div>
    </div>
  );
}
