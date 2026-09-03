import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { GripVerticalIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';
import type {
  PairComparisonItem,
  PairComparisonMode,
  PairComparisonSlot,
} from '@/renderer/components/creator/PairComparisonView';
import {
  ImageMagnifier,
  ImageMagnifierScaleBadge,
  type ImageMagnifierLayer,
  type ImageMagnifierPoint,
} from '@/renderer/components/creator/ImageMagnifier';
import {
  isPairComparisonMagnifierControl,
  type PairComparisonMagnifierSample,
  usePairComparisonMagnifier,
} from '@/renderer/components/creator/usePairComparisonMagnifier';
import {
  PairComparisonImageLayer,
  PairComparisonSingleCanvas,
  PairComparisonSlotBadge,
} from '@/renderer/components/creator/PairComparisonCanvas';
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
  magnifierActive: boolean;
  magnifierScale: number;
  labels: { a: string; b: string; swipePosition: string; magnifier: string; opacity: string };
  onPanChange(pan: PairComparisonPan): void;
  onSplitPositionChange(position: number): void;
  onOverlayMixChange(mix: number): void;
  onMagnifierActiveChange(active: boolean): void;
  onMagnifierScaleChange(scale: number): void;
  onAssetDragStart?(event: ReactDragEvent<HTMLElement>, assetId: string): void;
}

interface LocalRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CanvasGeometry {
  canvas: LocalRect;
  image: LocalRect;
}

interface ComparisonGeometry {
  a: CanvasGeometry | null;
  b: CanvasGeometry | null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function contains(rect: LocalRect, x: number, y: number) {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
}

function measureCanvas(
  stage: HTMLDivElement,
  canvas: HTMLDivElement | null,
  source: PairComparisonItem,
  zoom: number,
  pan: PairComparisonPan,
): CanvasGeometry | null {
  if (!canvas) return null;
  const stageBounds = stage.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  const canvasLeft = canvasBounds.left - stageBounds.left + canvas.clientLeft;
  const canvasTop = canvasBounds.top - stageBounds.top + canvas.clientTop;
  const canvasWidth = Math.max(1, canvas.clientWidth);
  const canvasHeight = Math.max(1, canvas.clientHeight);
  const fitScale = Math.min(1, canvasWidth / Math.max(1, source.width), canvasHeight / Math.max(1, source.height));
  const imageWidth = Math.max(1, source.width * fitScale * zoom);
  const imageHeight = Math.max(1, source.height * fitScale * zoom);
  return {
    canvas: {
      left: canvasBounds.left - stageBounds.left,
      top: canvasBounds.top - stageBounds.top,
      width: canvasBounds.width,
      height: canvasBounds.height,
    },
    image: {
      left: canvasLeft + (canvasWidth - imageWidth) / 2 + pan.x,
      top: canvasTop + (canvasHeight - imageHeight) / 2 + pan.y,
      width: imageWidth,
      height: imageHeight,
    },
  };
}

function pointInImage(geometry: CanvasGeometry | null, x: number, y: number): ImageMagnifierPoint | null {
  if (!geometry || !contains(geometry.canvas, x, y) || !contains(geometry.image, x, y)) return null;
  return {
    x: clamp((x - geometry.image.left) / geometry.image.width, 0, 1),
    y: clamp((y - geometry.image.top) / geometry.image.height, 0, 1),
  };
}

function pointInSharedImages(
  a: CanvasGeometry | null,
  b: CanvasGeometry | null,
  x: number,
  y: number,
): ImageMagnifierPoint | null {
  if (!a || !b || !contains(a.canvas, x, y) || !contains(a.image, x, y) || !contains(b.image, x, y)) return null;
  return { x: (x - a.image.left) / a.image.width, y: (y - a.image.top) / a.image.height };
}

function mapPointBetweenImages(point: ImageMagnifierPoint, from: CanvasGeometry, to: CanvasGeometry) {
  const x = from.image.left + point.x * from.image.width;
  const y = from.image.top + point.y * from.image.height;
  return { x: (x - to.image.left) / to.image.width, y: (y - to.image.top) / to.image.height };
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

function SampleMarker({ geometry, point }: { geometry: CanvasGeometry | null; point: ImageMagnifierPoint }) {
  if (!geometry) return null;
  const left = geometry.image.left + point.x * geometry.image.width;
  const top = geometry.image.top + point.y * geometry.image.height;
  if (!contains(geometry.canvas, left, top)) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-30 size-4 -translate-x-1/2 -translate-y-1/2"
      style={{ left, top }}
    >
      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-foreground outline outline-1 outline-background/80" />
      <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-foreground outline outline-1 outline-background/80" />
    </span>
  );
}

function lensCenter(geometry: CanvasGeometry, point: ImageMagnifierPoint, diameter: number) {
  const radius = diameter / 2;
  const horizontalInset = Math.min(radius + 8, geometry.canvas.width / 2);
  const verticalInset = Math.min(radius + 8, geometry.canvas.height / 2);
  const left = geometry.image.left + point.x * geometry.image.width;
  const top = geometry.image.top + point.y * geometry.image.height;
  return {
    left: clamp(
      left,
      geometry.canvas.left + horizontalInset,
      geometry.canvas.left + geometry.canvas.width - horizontalInset,
    ),
    top: clamp(top, geometry.canvas.top + verticalInset, geometry.canvas.top + geometry.canvas.height - verticalInset),
  };
}

function sideBySideLensCenter(
  geometry: ComparisonGeometry,
  anchor: PairComparisonMagnifierSample['anchor'],
  diameter: number,
  gap: number,
) {
  if (!geometry.a || !geometry.b) return anchor;
  const left = Math.min(geometry.a.canvas.left, geometry.b.canvas.left);
  const top = Math.min(geometry.a.canvas.top, geometry.b.canvas.top);
  const right = Math.max(
    geometry.a.canvas.left + geometry.a.canvas.width,
    geometry.b.canvas.left + geometry.b.canvas.width,
  );
  const bottom = Math.max(
    geometry.a.canvas.top + geometry.a.canvas.height,
    geometry.b.canvas.top + geometry.b.canvas.height,
  );
  const horizontalInset = Math.min((diameter * 2 + gap) / 2 + 8, (right - left) / 2);
  const verticalInset = Math.min(diameter / 2 + 8, (bottom - top) / 2);
  return {
    left: clamp(anchor.left, left + horizontalInset, right - horizontalInset),
    top: clamp(anchor.top, top + verticalInset, bottom - verticalInset),
  };
}

function layerFor(
  source: PairComparisonItem,
  geometry: CanvasGeometry,
  options: Pick<ImageMagnifierLayer, 'opacity' | 'clipPath' | 'point'> = {},
): ImageMagnifierLayer {
  return {
    id: `${source.id}:${options.clipPath ?? 'full'}`,
    src: source.mediaUrl,
    width: geometry.image.width,
    height: geometry.image.height,
    ...options,
  };
}

function OverlayOpacityControl({
  labels,
  overlayMix,
  onOverlayMixChange,
}: {
  labels: Props['labels'];
  overlayMix: number;
  onOverlayMixChange(mix: number): void;
}) {
  return (
    <div
      data-magnifier-control
      className="pointer-events-auto flex h-7 w-[165px] items-center gap-1 rounded-sm border bg-overlay/95 px-1 shadow-overlay"
    >
      <Button
        type="button"
        variant="ghost"
        size="2xs"
        className="h-5 w-5 px-0 text-[10px]"
        title={`${labels.a} 100%`}
        aria-label={`${labels.a} 100%`}
        onClick={() => onOverlayMixChange(0)}
      >
        {labels.a}
      </Button>
      <Slider
        value={[overlayMix]}
        min={0}
        max={100}
        step={1}
        aria-label={labels.opacity}
        aria-valuetext={`${labels.a} ${100 - overlayMix}%, ${labels.b} ${overlayMix}%`}
        className="min-w-0 flex-1 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-track]]:h-1"
        onDoubleClick={() => onOverlayMixChange(50)}
        onValueChange={(value) => onOverlayMixChange(value[0] ?? 50)}
      />
      <Button
        type="button"
        variant="ghost"
        size="2xs"
        className="h-5 px-1 font-mono text-[10px] tabular-nums"
        title={`${labels.b} 100%`}
        aria-label={`${labels.b} 100%`}
        onClick={() => onOverlayMixChange(100)}
      >
        {labels.b}
      </Button>
    </div>
  );
}

function ComparisonMagnifierOverlay({
  a,
  b,
  geometry,
  labels,
  mode,
  overlayMix,
  anchor,
  point,
  sampleLocked,
  scale,
  opacityFeedbackVisible,
  scaleFeedbackVisible,
  soloSlot,
  onOverlayMixChange,
}: {
  a: PairComparisonItem;
  b: PairComparisonItem;
  geometry: ComparisonGeometry;
  labels: Props['labels'];
  mode: PairComparisonMode;
  overlayMix: number;
  anchor: PairComparisonMagnifierSample['anchor'];
  point: ImageMagnifierPoint;
  sampleLocked: boolean;
  scale: number;
  opacityFeedbackVisible: boolean;
  scaleFeedbackVisible: boolean;
  soloSlot: PairComparisonSlot | null;
  onOverlayMixChange(mix: number): void;
}) {
  const slotLabel = soloSlot === 'B' ? labels.b : labels.a;
  const soloSource = soloSlot === 'B' ? b : a;
  const soloGeometry = soloSlot === 'B' ? geometry.b : geometry.a;

  if (soloSlot && soloGeometry) {
    const center = lensCenter(soloGeometry, point, 165);
    return (
      <div className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2" style={center}>
        <ImageMagnifier
          diameter={165}
          label={`${labels.magnifier} · ${slotLabel} · ${scale}×`}
          layers={[layerFor(soloSource, soloGeometry)]}
          point={point}
          scale={scale}
        >
          <ImageMagnifierScaleBadge scale={scale} visible={scaleFeedbackVisible} />
        </ImageMagnifier>
      </div>
    );
  }

  if (!geometry.a || !geometry.b) return null;

  if (mode === 'SIDE_BY_SIDE') {
    const diameter = 150;
    const gap = 8;
    const center = sideBySideLensCenter(geometry, anchor, diameter, gap);
    return (
      <div
        className="pointer-events-none absolute z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2"
        style={center}
      >
        <ImageMagnifier
          diameter={diameter}
          label={`${labels.magnifier} · ${labels.a} · ${scale}×`}
          layers={[layerFor(a, geometry.a)]}
          point={point}
          scale={scale}
        />
        <ImageMagnifier
          diameter={diameter}
          label={`${labels.magnifier} · ${labels.b} · ${scale}×`}
          layers={[layerFor(b, geometry.b)]}
          point={point}
          scale={scale}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-2 left-1/2 z-40 -translate-x-1/2 rounded-sm border bg-overlay/95 px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums transition-opacity duration-fast motion-reduce:transition-none',
            scaleFeedbackVisible ? 'opacity-100' : 'opacity-0',
          )}
        >
          {scale}×
        </span>
      </div>
    );
  }

  if (mode === 'SWIPE') {
    const center = lensCenter(geometry.a, point, 165);
    const bPoint = mapPointBetweenImages(point, geometry.a, geometry.b);
    const layers = [
      layerFor(a, geometry.a, { clipPath: 'inset(0 50% 0 0)' }),
      layerFor(b, geometry.b, { clipPath: 'inset(0 0 0 50%)', point: bPoint }),
    ];
    return (
      <div className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2" style={center}>
        <ImageMagnifier
          diameter={165}
          label={`${labels.magnifier} · ${labels.a}/${labels.b} · ${scale}×`}
          layers={layers}
          point={point}
          scale={scale}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-px -translate-x-1/2 bg-foreground/80 outline outline-1 outline-background/80" />
          <ImageMagnifierScaleBadge scale={scale} visible={scaleFeedbackVisible} />
        </ImageMagnifier>
      </div>
    );
  }

  const bPoint = mapPointBetweenImages(point, geometry.a, geometry.b);
  const layers = [layerFor(a, geometry.a), layerFor(b, geometry.b, { opacity: overlayMix / 100, point: bPoint })];
  const center = lensCenter(geometry.a, point, 165);
  const controlPosition =
    center.top < geometry.a.canvas.top + geometry.a.canvas.height / 2 ? 'top-full mt-1' : 'bottom-full mb-1';
  return (
    <div className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2" style={center}>
      <ImageMagnifier
        diameter={165}
        label={`${labels.magnifier} · ${labels.opacity} · ${labels.b} ${overlayMix}% · ${scale}×`}
        layers={layers}
        point={point}
        scale={scale}
      >
        <ImageMagnifierScaleBadge scale={scale} visible={scaleFeedbackVisible} />
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-2 left-2 z-30 rounded-sm border bg-overlay/90 px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums transition-opacity duration-fast motion-reduce:transition-none',
            opacityFeedbackVisible ? 'opacity-100' : 'opacity-0',
          )}
        >
          {labels.b} {overlayMix}%
        </span>
      </ImageMagnifier>
      {sampleLocked && (
        <div className={cn('absolute left-1/2 -translate-x-1/2', controlPosition)}>
          <OverlayOpacityControl labels={labels} overlayMix={overlayMix} onOverlayMixChange={onOverlayMixChange} />
        </div>
      )}
    </div>
  );
}

function useComparisonGeometry({
  a,
  b,
  mode,
  soloSlot,
  zoom,
  pan,
}: Pick<Props, 'a' | 'b' | 'mode' | 'soloSlot' | 'zoom' | 'pan'>) {
  const stageRef = useRef<HTMLDivElement>(null);
  const aCanvasRef = useRef<HTMLDivElement>(null);
  const bCanvasRef = useRef<HTMLDivElement>(null);
  const sharedCanvasRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<ComparisonGeometry>({ a: null, b: null });

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (soloSlot) {
      const source = soloSlot === 'A' ? a : b;
      const measured = measureCanvas(stage, sharedCanvasRef.current, source, zoom, pan);
      setGeometry(soloSlot === 'A' ? { a: measured, b: null } : { a: null, b: measured });
      return;
    }
    if (mode === 'SIDE_BY_SIDE') {
      setGeometry({
        a: measureCanvas(stage, aCanvasRef.current, a, zoom, pan),
        b: measureCanvas(stage, bCanvasRef.current, b, zoom, pan),
      });
      return;
    }
    setGeometry({
      a: measureCanvas(stage, sharedCanvasRef.current, a, zoom, pan),
      b: measureCanvas(stage, sharedCanvasRef.current, b, zoom, pan),
    });
  }, [a, b, mode, pan, soloSlot, zoom]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    const elements = [stageRef.current, aCanvasRef.current, bCanvasRef.current, sharedCanvasRef.current];
    for (const element of elements) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  return { stageRef, aCanvasRef, bCanvasRef, sharedCanvasRef, geometry };
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
  magnifierActive,
  magnifierScale,
  labels,
  onPanChange,
  onSplitPositionChange,
  onOverlayMixChange,
  onMagnifierActiveChange,
  onMagnifierScaleChange,
  onAssetDragStart,
}: Props) {
  const { stageRef, aCanvasRef, bCanvasRef, sharedCanvasRef, geometry } = useComparisonGeometry({
    a,
    b,
    mode,
    soloSlot,
    zoom,
    pan,
  });
  const drag = useRef<{ pointerX: number; pointerY: number; pan: PairComparisonPan } | null>(null);
  const [dragging, setDragging] = useState(false);

  const resolveSample = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = stageRef.current?.getBoundingClientRect();
      if (!bounds) return null;
      const x = clientX - bounds.left;
      const y = clientY - bounds.top;
      const point =
        soloSlot === 'A'
          ? pointInImage(geometry.a, x, y)
          : soloSlot === 'B'
            ? pointInImage(geometry.b, x, y)
            : mode === 'SIDE_BY_SIDE'
              ? (pointInImage(geometry.a, x, y) ?? pointInImage(geometry.b, x, y))
              : pointInSharedImages(geometry.a, geometry.b, x, y);
      return point ? { anchor: { left: x, top: y }, point } : null;
    },
    [geometry, mode, soloSlot, stageRef],
  );

  const {
    lockSample,
    moveSample,
    onPointerLeave: magnifierPointerLeave,
    onWheel: magnifierWheel,
    opacityFeedbackVisible,
    sample,
    sampleLocked,
    scaleFeedbackVisible,
  } = usePairComparisonMagnifier({
    active: magnifierActive,
    mode,
    onActiveChange: onMagnifierActiveChange,
    onOverlayMixChange,
    onScaleChange: onMagnifierScaleChange,
    overlayMix,
    resolveSample,
    scale: magnifierScale,
    soloSlot,
    sourceAId: a.id,
    sourceBId: b.id,
  });

  useEffect(() => {
    if (!magnifierActive) return;
    drag.current = null;
    setDragging(false);
  }, [magnifierActive]);

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
  const soloGeometry = soloSlot === 'B' ? geometry.b : geometry.a;
  const assetDragEnabled = Boolean(onAssetDragStart) && !magnifierActive && zoom <= 1;

  function sharedDragSource(event: ReactDragEvent<HTMLDivElement>) {
    if (mode === 'SWIPE') {
      const bounds = event.currentTarget.getBoundingClientRect();
      const position = bounds.width > 0 ? ((event.clientX - bounds.left) / bounds.width) * 100 : 0;
      return position >= splitPosition ? b : a;
    }
    return overlayMix >= 50 ? b : a;
  }

  return (
    <div
      ref={stageRef}
      data-pair-comparison-stage
      data-magnifier-active={magnifierActive || undefined}
      className={cn(
        'relative size-full min-h-0 overflow-hidden',
        magnifierActive && 'cursor-crosshair',
        !magnifierActive && zoom > 1 && (dragging ? 'cursor-grabbing touch-none' : 'cursor-grab touch-none'),
      )}
      onPointerDown={(event) => {
        if (isPairComparisonMagnifierControl(event.target)) return;
        if (magnifierActive && event.button === 0) {
          if (lockSample(event.clientX, event.clientY)) event.preventDefault();
          return;
        }
        if (zoom <= 1 || event.button !== 0) return;
        drag.current = { pointerX: event.clientX, pointerY: event.clientY, pan };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (magnifierActive) {
          moveSample(event.clientX, event.clientY, event.target);
          return;
        }
        movePan(event);
      }}
      onPointerLeave={magnifierPointerLeave}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onWheel={magnifierWheel}
    >
      {soloSlot && (
        <PairComparisonSingleCanvas
          canvasRef={sharedCanvasRef}
          slotLabel={slotLabel}
          source={soloSource}
          zoom={zoom}
          pan={pan}
          draggable={assetDragEnabled}
          onDragStart={(event) => onAssetDragStart?.(event, soloSource.assetId)}
        />
      )}
      {!soloSlot && mode === 'SIDE_BY_SIDE' && (
        <div className="grid size-full min-h-0 grid-cols-2 gap-2">
          <PairComparisonSingleCanvas
            canvasRef={aCanvasRef}
            slotLabel={labels.a}
            source={a}
            zoom={zoom}
            pan={pan}
            draggable={assetDragEnabled}
            onDragStart={(event) => onAssetDragStart?.(event, a.assetId)}
          />
          <PairComparisonSingleCanvas
            canvasRef={bCanvasRef}
            slotLabel={labels.b}
            source={b}
            zoom={zoom}
            pan={pan}
            draggable={assetDragEnabled}
            onDragStart={(event) => onAssetDragStart?.(event, b.assetId)}
          />
        </div>
      )}
      {!soloSlot && mode === 'SWIPE' && (
        <div
          ref={sharedCanvasRef}
          data-comparison-canvas
          draggable={assetDragEnabled}
          className="relative isolate size-full min-h-0 overflow-hidden border bg-surface-sunken"
          onDragStart={(event) => onAssetDragStart?.(event, sharedDragSource(event).assetId)}
        >
          <ImageAmbientBackdrop src={a.mediaUrl} />
          <ImageAmbientBackdrop src={b.mediaUrl} style={{ clipPath: `inset(0 0 0 ${splitPosition}%)` }} />
          <PairComparisonImageLayer slotLabel={labels.a} source={a} zoom={zoom} pan={pan} />
          <PairComparisonImageLayer slotLabel={labels.b} source={b} zoom={zoom} pan={pan} clipStart={splitPosition} />
          <PairComparisonSlotBadge slotLabel={labels.a} />
          <PairComparisonSlotBadge slotLabel={labels.b} side="right" />
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
          ref={sharedCanvasRef}
          data-comparison-canvas
          draggable={assetDragEnabled}
          className="relative isolate size-full min-h-0 overflow-hidden border bg-surface-sunken"
          onDragStart={(event) => onAssetDragStart?.(event, sharedDragSource(event).assetId)}
        >
          <ImageAmbientBackdrop src={a.mediaUrl} />
          <ImageAmbientBackdrop src={b.mediaUrl} style={{ opacity: overlayMix / 100 }} />
          <PairComparisonImageLayer slotLabel={labels.a} source={a} zoom={zoom} pan={pan} />
          <PairComparisonImageLayer slotLabel={labels.b} source={b} zoom={zoom} pan={pan} opacity={overlayMix / 100} />
          <PairComparisonSlotBadge slotLabel={labels.a} />
          <PairComparisonSlotBadge slotLabel={labels.b} side="right" />
        </div>
      )}
      {magnifierActive && sample && (
        <>
          {soloSlot && <SampleMarker geometry={soloGeometry} point={sample.point} />}
          {!soloSlot && mode === 'SIDE_BY_SIDE' && (
            <>
              <SampleMarker geometry={geometry.a} point={sample.point} />
              <SampleMarker geometry={geometry.b} point={sample.point} />
            </>
          )}
          {!soloSlot && mode !== 'SIDE_BY_SIDE' && (
            <SampleMarker geometry={geometry.a ?? geometry.b} point={sample.point} />
          )}
          <ComparisonMagnifierOverlay
            a={a}
            b={b}
            geometry={geometry}
            labels={labels}
            mode={mode}
            overlayMix={overlayMix}
            opacityFeedbackVisible={opacityFeedbackVisible}
            anchor={sample.anchor}
            point={sample.point}
            sampleLocked={sampleLocked}
            scale={magnifierScale}
            scaleFeedbackVisible={scaleFeedbackVisible}
            soloSlot={soloSlot}
            onOverlayMixChange={onOverlayMixChange}
          />
        </>
      )}
    </div>
  );
}
