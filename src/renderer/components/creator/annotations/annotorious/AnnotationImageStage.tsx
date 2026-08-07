import {
  UserSelectAction,
  createImageAnnotator,
  type Color,
  type AnnotoriousImageAnnotator,
  type DrawingStyle,
  type ImageAnnotation,
} from '@annotorious/react';
import '@annotorious/react/annotorious-react.css';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from 'react';
import type { AssetDto } from '@/shared/contracts';
import { readCssToken, type RuntimeTokenName } from '@/renderer/lib/tokens';
import { cn } from '@/renderer/lib/utils';
import type {
  AnnotationLabels,
  AnnotationMode,
  BrushMode,
  NumberedAnnotation,
  PendingAnnotation,
} from '@/renderer/components/creator/annotations/types';
import { BrushAnnotationLayer } from '@/renderer/components/creator/annotations/BrushAnnotationLayer';
import { AnnotationMarkerLayer } from '@/renderer/components/creator/annotations/annotorious/AnnotationMarkerLayer';
import {
  fromAnnotoriousRectangle,
  pendingAnnotationId,
  toAnnotoriousAnnotation,
  toPendingAnnotoriousAnnotation,
  type ImageDimensions,
} from '@/renderer/components/creator/annotations/annotorious/geometry-adapter';

export interface AnnotationImageStageHandle {
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
}

interface Props {
  active: boolean;
  asset: AssetDto;
  annotations: NumberedAnnotation[];
  labels: AnnotationLabels;
  brushMode: BrushMode;
  brushRadius: number;
  markersVisible: boolean;
  mode: AnnotationMode;
  pending: PendingAnnotation | null;
  selectedId: string | null;
  className?: string;
  onPendingChange(annotation: PendingAnnotation): void;
  onSelect(id: string | null): void;
}

interface ViewportSize {
  width: number;
  height: number;
}

const stagePadding = 24;
const zoomFactor = 1.25;
const minZoom = 0.5;
const maxZoom = 4;

function annotationColor(name: RuntimeTokenName): Color {
  return readCssToken(name) as Color;
}

function annotationStyle(annotation: ImageAnnotation, state?: { selected?: boolean }): DrawingStyle {
  const isPending = Boolean(annotation.properties?.pending);
  const isClosed = annotation.properties?.status && annotation.properties.status !== 'OPEN';
  if (isPending) {
    const changed = annotationColor('--state-changed-fg');
    return { stroke: changed, strokeWidth: 2, fill: changed, fillOpacity: 0.14 };
  }
  if (isClosed) {
    const locked = annotationColor('--state-locked-fg');
    return { stroke: locked, strokeWidth: 2, fill: locked, fillOpacity: 0.04 };
  }
  const selected = annotationColor('--selected-foreground');
  return {
    stroke: state?.selected ? selected : annotationColor('--primary'),
    strokeWidth: state?.selected ? 3 : 2,
    fill: selected,
    fillOpacity: state?.selected ? 0.14 : 0.08,
  };
}

export const AnnotationImageStage = forwardRef(function AnnotationImageStage(
  {
    active,
    asset,
    annotations,
    labels,
    brushMode,
    brushRadius,
    markersVisible,
    mode,
    pending,
    selectedId,
    className,
    onPendingChange,
    onSelect,
  }: Props,
  ref: ForwardedRef<AnnotationImageStageHandle>,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [loadedAssetId, setLoadedAssetId] = useState<string | null>(null);
  const annotatorRef = useRef<AnnotoriousImageAnnotator<ImageAnnotation, ImageAnnotation> | null>(null);
  const [zoom, setZoom] = useState(1);
  const dimensions = useMemo<ImageDimensions>(
    () => ({
      width: Math.max(1, asset.width),
      height: Math.max(1, asset.height),
    }),
    [asset.height, asset.width],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: () => setZoom(1),
      zoomIn: () => setZoom((current) => Math.min(maxZoom, current * zoomFactor)),
      zoomOut: () => setZoom((current) => Math.max(minZoom, current / zoomFactor)),
    }),
    [],
  );

  useEffect(() => setZoom(1), [asset.id]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const measure = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const stageSize = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) return null;
    const availableWidth = Math.max(1, viewportSize.width - stagePadding * 2);
    const availableHeight = Math.max(1, viewportSize.height - stagePadding * 2);
    const fitScale = Math.min(availableWidth / dimensions.width, availableHeight / dimensions.height);
    return {
      width: Math.max(1, dimensions.width * fitScale * zoom),
      height: Math.max(1, dimensions.height * fitScale * zoom),
    };
  }, [dimensions.height, dimensions.width, viewportSize.height, viewportSize.width, zoom]);

  const annotatorReady = active && Boolean(stageSize) && loadedAssetId === asset.id;

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!annotatorReady || !image?.complete || !image.naturalWidth) return undefined;

    const instance = createImageAnnotator<ImageAnnotation, ImageAnnotation>(image, {
      drawingEnabled: mode === 'RECTANGLE',
      drawingMode: 'drag',
      modalSelect: true,
      style: annotationStyle,
      userSelectAction: (annotation) =>
        annotation.id === pendingAnnotationId ? UserSelectAction.NONE : UserSelectAction.SELECT,
    });
    instance.element.className = 'size-full';
    instance.setDrawingTool('rectangle');
    annotatorRef.current = instance;

    const drawingLayer = instance.element.querySelector<SVGSVGElement>('svg.a9s-annotationlayer');
    const captureDrawingPointer = (event: PointerEvent) => {
      if (event.isPrimary && event.button === 0 && instance.isDrawingEnabled()) {
        drawingLayer?.setPointerCapture(event.pointerId);
      }
    };
    drawingLayer?.addEventListener('pointerdown', captureDrawingPointer, true);

    return () => {
      drawingLayer?.removeEventListener('pointerdown', captureDrawingPointer, true);
      if (annotatorRef.current === instance) annotatorRef.current = null;
      instance.destroy();
    };
  }, [annotatorReady, asset.id]);

  useEffect(() => {
    const instance = annotatorRef.current;
    if (!instance) return;
    instance.setDrawingEnabled(mode === 'RECTANGLE');
    instance.element.style.pointerEvents = mode === 'BRUSH' ? 'none' : '';
  }, [annotatorReady, asset.id, mode]);

  useEffect(() => {
    annotatorRef.current?.setVisible(markersVisible);
  }, [annotatorReady, asset.id, markersVisible]);

  useEffect(() => {
    const instance = annotatorRef.current;
    if (!instance) return;
    const mapped = annotations.flatMap((item) => {
      const annotation = toAnnotoriousAnnotation(item, dimensions);
      return annotation ? [annotation] : [];
    });
    const pendingRectangle = toPendingAnnotoriousAnnotation(pending, dimensions);
    instance.setAnnotations(pendingRectangle ? [...mapped, pendingRectangle] : mapped, true);
  }, [annotations, annotatorReady, asset.id, dimensions, pending]);

  useEffect(() => {
    const instance = annotatorRef.current;
    if (!instance) return;
    if (selectedId && instance.getAnnotationById(selectedId)) instance.setSelected(selectedId, false);
    else if (instance.getSelected().length) instance.setSelected();
  }, [annotatorReady, asset.id, selectedId]);

  useEffect(() => {
    const instance = annotatorRef.current;
    if (!instance) return undefined;
    const created = (annotation: ImageAnnotation) => {
      const rectangle = fromAnnotoriousRectangle(annotation, dimensions);
      instance.removeAnnotation(annotation.id);
      if (rectangle) onPendingChange(rectangle);
    };
    const selectionChanged = (selected: ImageAnnotation[]) => {
      const id = selected[0]?.id;
      onSelect(id && id !== pendingAnnotationId ? id : null);
    };
    instance.on('createAnnotation', created);
    instance.on('selectionChanged', selectionChanged);
    return () => {
      instance.off('createAnnotation', created);
      instance.off('selectionChanged', selectionChanged);
    };
  }, [annotatorReady, asset.id, dimensions, onPendingChange, onSelect]);

  return (
    <div ref={viewportRef} className={cn('relative min-h-0 min-w-0 overflow-auto bg-media-surround', className)}>
      {!stageSize ? (
        <div className="flex size-full items-center justify-center p-4">
          <img
            className="max-h-full max-w-full object-contain"
            src={asset.mediaUrl}
            alt=""
            decoding="async"
            draggable={false}
          />
        </div>
      ) : (
        <div
          className="flex items-center justify-center"
          style={{
            minWidth: '100%',
            minHeight: '100%',
            width: Math.max(viewportSize.width, stageSize.width + stagePadding * 2),
            height: Math.max(viewportSize.height, stageSize.height + stagePadding * 2),
          }}
        >
          <div
            className={cn(
              'relative shrink-0 overflow-hidden bg-media-surround-light ring-1 ring-border',
              active && mode !== 'view' && 'cursor-crosshair',
            )}
            style={{ width: stageSize.width, height: stageSize.height }}
          >
            <img
              ref={imageRef}
              className="size-full select-none object-fill"
              src={asset.mediaUrl}
              alt=""
              decoding="async"
              draggable={false}
              onLoad={() => setLoadedAssetId(asset.id)}
            />
            <BrushAnnotationLayer
              active={active && mode === 'BRUSH'}
              annotations={annotations}
              brushMode={brushMode}
              brushRadius={brushRadius}
              dimensions={dimensions}
              pending={pending}
              selectedId={selectedId}
              visible={markersVisible}
              onPendingChange={onPendingChange}
            />
            {active && (
              <AnnotationMarkerLayer
                annotations={annotations}
                labels={labels}
                selectedId={selectedId}
                visible={markersVisible}
                onSelect={onSelect}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
});
