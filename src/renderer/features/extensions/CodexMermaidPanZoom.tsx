import { BookOpenIcon, MinusIcon, PlusIcon, ScanIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Button } from '@/renderer/components/ui/button';
import { CodexMermaidMinimap, type MermaidViewportGeometry } from '@/renderer/features/extensions/CodexMermaidMinimap';
import { cn } from '@/renderer/lib/utils';

interface Props {
  src: string;
  alt: string;
  labels: {
    fit: string;
    read: string;
    minimap: string;
    zoomIn: string;
    zoomOut: string;
  };
}

interface Pan {
  x: number;
  y: number;
}

interface ViewState {
  zoom: number;
  pan: Pan;
}

interface DragState {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  pan: Pan;
}

interface ImageGeometry extends MermaidViewportGeometry {
  naturalWidth: number;
  naturalHeight: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;
const CENTERED_VIEW: ViewState = { zoom: MIN_ZOOM, pan: { x: 0, y: 0 } };
const ESTIMATED_MERMAID_FONT_SIZE = 16;
const READABLE_TEXT_SIZE = 12;
const NAVIGATION_TEXT_THRESHOLD = 9;
const EXTREME_ASPECT_RATIO = 4;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stepZoom(current: number, direction: -1 | 1) {
  if (direction > 0) return ZOOM_LEVELS.find((level) => level > current + 0.001) ?? MAX_ZOOM;
  for (let index = ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
    const level = ZOOM_LEVELS[index]!;
    if (level < current - 0.001) return level;
  }
  return MIN_ZOOM;
}

function measureGeometry(viewport: HTMLDivElement, image: HTMLImageElement): ImageGeometry | null {
  if (!viewport.clientWidth || !viewport.clientHeight || !image.offsetWidth || !image.offsetHeight) return null;
  if (!image.naturalWidth || !image.naturalHeight) return null;
  return {
    viewportWidth: viewport.clientWidth,
    viewportHeight: viewport.clientHeight,
    imageWidth: image.offsetWidth,
    imageHeight: image.offsetHeight,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  };
}

interface ZoomControlsProps {
  labels: Props['labels'];
  zoom: number;
  readingZoom: number;
  navigationRecommended: boolean;
  onZoomOut(): void;
  onFit(): void;
  onRead(): void;
  onZoomIn(): void;
}

function MermaidZoomControls({
  labels,
  zoom,
  readingZoom,
  navigationRecommended,
  onZoomOut,
  onFit,
  onRead,
  onZoomIn,
}: ZoomControlsProps) {
  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border bg-background/95 p-1 shadow-overlay">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={zoom <= MIN_ZOOM}
        aria-label={labels.zoomOut}
        title={labels.zoomOut}
        onClick={onZoomOut}
      >
        <MinusIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-w-16 px-2 font-mono tabular-nums"
        aria-label={labels.fit}
        title={labels.fit}
        onClick={onFit}
      >
        <ScanIcon className="size-4" />
        {Math.round(zoom * 100)}%
      </Button>
      {navigationRecommended && readingZoom > MIN_ZOOM && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.read}
          title={labels.read}
          aria-pressed={Math.abs(zoom - readingZoom) < 0.001}
          onClick={onRead}
        >
          <BookOpenIcon className="size-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={zoom >= MAX_ZOOM}
        aria-label={labels.zoomIn}
        title={labels.zoomIn}
        onClick={onZoomIn}
      >
        <PlusIcon className="size-4" />
      </Button>
    </div>
  );
}

export function CodexMermaidPanZoom({ src, alt, labels }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewRef = useRef<ViewState>(CENTERED_VIEW);
  const dragRef = useRef<DragState | null>(null);
  const [view, setView] = useState<ViewState>(CENTERED_VIEW);
  const [dragging, setDragging] = useState(false);
  const [geometry, setGeometry] = useState<ImageGeometry | null>(null);

  const commitView = useCallback((next: ViewState) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const constrainPan = useCallback((pan: Pan, zoom: number) => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return pan;
    const maximumX = Math.max(0, (image.offsetWidth * zoom - viewport.clientWidth) / 2);
    const maximumY = Math.max(0, (image.offsetHeight * zoom - viewport.clientHeight) / 2);
    return {
      x: clamp(pan.x, -maximumX, maximumX),
      y: clamp(pan.y, -maximumY, maximumY),
    };
  }, []);

  const resetView = useCallback(() => {
    commitView(CENTERED_VIEW);
  }, [commitView]);

  const updateGeometry = useCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return;
    const next = measureGeometry(viewport, image);
    setGeometry((current) => {
      if (
        current?.viewportWidth === next?.viewportWidth &&
        current?.viewportHeight === next?.viewportHeight &&
        current?.imageWidth === next?.imageWidth &&
        current?.imageHeight === next?.imageHeight &&
        current?.naturalWidth === next?.naturalWidth &&
        current?.naturalHeight === next?.naturalHeight
      )
        return current;
      return next;
    });
  }, []);

  const zoomAt = useCallback(
    (requestedZoom: number, clientPoint?: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      const current = viewRef.current;
      const zoom = clamp(requestedZoom, MIN_ZOOM, MAX_ZOOM);
      if (zoom === MIN_ZOOM) {
        resetView();
        return;
      }
      if (!viewport || zoom === current.zoom) return;

      const bounds = viewport.getBoundingClientRect();
      const anchorX = clientPoint ? clientPoint.x - bounds.left - bounds.width / 2 : 0;
      const anchorY = clientPoint ? clientPoint.y - bounds.top - bounds.height / 2 : 0;
      const ratio = zoom / current.zoom;
      const pan = constrainPan(
        {
          x: anchorX - (anchorX - current.pan.x) * ratio,
          y: anchorY - (anchorY - current.pan.y) * ratio,
        },
        zoom,
      );
      commitView({ zoom, pan });
    },
    [commitView, constrainPan, resetView],
  );

  useEffect(() => {
    resetView();
    setGeometry(null);
  }, [resetView, src]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      updateGeometry();
      const current = viewRef.current;
      const pan = constrainPan(current.pan, current.zoom);
      if (pan.x !== current.pan.x || pan.y !== current.pan.y) commitView({ ...current, pan });
    });
    observer.observe(viewport);
    observer.observe(image);
    updateGeometry();
    return () => observer.disconnect();
  }, [commitView, constrainPan, updateGeometry]);

  const fitScale = geometry
    ? Math.min(geometry.imageWidth / geometry.naturalWidth, geometry.imageHeight / geometry.naturalHeight)
    : 1;
  const aspectRatio = geometry ? geometry.naturalWidth / geometry.naturalHeight : 1;
  const extentRatio = Math.max(aspectRatio, 1 / aspectRatio);
  const readingZoom = clamp(READABLE_TEXT_SIZE / ESTIMATED_MERMAID_FONT_SIZE / fitScale, MIN_ZOOM, MAX_ZOOM);
  const navigationRecommended =
    geometry !== null &&
    (extentRatio >= EXTREME_ASPECT_RATIO || ESTIMATED_MERMAID_FONT_SIZE * fitScale < NAVIGATION_TEXT_THRESHOLD);

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.deltaY) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
    const sensitivity = event.ctrlKey ? 0.01 : 0.002;
    zoomAt(viewRef.current.zoom * Math.exp(-delta * sensitivity), { x: event.clientX, y: event.clientY });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomAt(stepZoom(viewRef.current.zoom, 1));
    } else if (event.key === '-') {
      event.preventDefault();
      zoomAt(stepZoom(viewRef.current.zoom, -1));
    } else if (event.key === '0') {
      event.preventDefault();
      resetView();
    } else if (viewRef.current.zoom > MIN_ZOOM && event.key.startsWith('Arrow')) {
      event.preventDefault();
      const step = event.shiftKey ? 96 : 40;
      const current = viewRef.current;
      const pan = constrainPan(
        {
          x: current.pan.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
          y: current.pan.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
        },
        current.zoom,
      );
      commitView({ ...current, pan });
    }
  }

  function navigateFromMinimap(point: { x: number; y: number }) {
    const image = imageRef.current;
    if (!image) return;
    const current = viewRef.current;
    const pan = constrainPan(
      {
        x: (0.5 - point.x) * image.offsetWidth * current.zoom,
        y: (0.5 - point.y) * image.offsetHeight * current.zoom,
      },
      current.zoom,
    );
    commitView({ ...current, pan });
  }

  return (
    <div className="relative size-full min-h-0 overflow-hidden bg-surface-sunken">
      <div
        ref={viewportRef}
        role="region"
        tabIndex={0}
        aria-label={alt}
        className={cn(
          'grid size-full min-h-0 place-items-center overflow-hidden p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          view.zoom > MIN_ZOOM && (dragging ? 'cursor-grabbing touch-none' : 'cursor-grab touch-none'),
        )}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          if (viewRef.current.zoom <= MIN_ZOOM || event.button !== 0) return;
          dragRef.current = {
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            pan: viewRef.current.pan,
          };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const current = viewRef.current;
          const pan = constrainPan(
            {
              x: drag.pan.x + event.clientX - drag.pointerX,
              y: drag.pan.y + event.clientY - drag.pointerY,
            },
            current.zoom,
          );
          commitView({ ...current, pan });
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onDoubleClick={(event) => {
          if (viewRef.current.zoom > MIN_ZOOM) resetView();
          else zoomAt(2, { x: event.clientX, y: event.clientY });
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none max-h-full max-w-full select-none"
          style={{ transform: `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.zoom})` }}
          onLoad={() => {
            requestAnimationFrame(() => {
              updateGeometry();
              const current = viewRef.current;
              commitView({ ...current, pan: constrainPan(current.pan, current.zoom) });
            });
          }}
        />
      </div>

      {navigationRecommended && view.zoom > MIN_ZOOM && geometry && (
        <CodexMermaidMinimap
          src={src}
          label={labels.minimap}
          geometry={geometry}
          zoom={view.zoom}
          pan={view.pan}
          onNavigate={navigateFromMinimap}
        />
      )}

      <MermaidZoomControls
        labels={labels}
        zoom={view.zoom}
        readingZoom={readingZoom}
        navigationRecommended={navigationRecommended}
        onZoomOut={() => zoomAt(stepZoom(viewRef.current.zoom, -1))}
        onFit={resetView}
        onRead={() => commitView({ zoom: readingZoom, pan: { x: 0, y: 0 } })}
        onZoomIn={() => zoomAt(stepZoom(viewRef.current.zoom, 1))}
      />
    </div>
  );
}
