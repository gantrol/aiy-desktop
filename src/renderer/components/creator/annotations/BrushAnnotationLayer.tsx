import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { AnnotationBrushGeometry, AnnotationBrushStroke } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import type { BrushMode, NumberedAnnotation, PendingAnnotation } from '@/renderer/components/creator/annotations/types';

interface ImageDimensions {
  width: number;
  height: number;
}

interface Props {
  active: boolean;
  annotations: NumberedAnnotation[];
  brushMode: BrushMode;
  brushRadius: number;
  dimensions: ImageDimensions;
  pending: PendingAnnotation | null;
  selectedId: string | null;
  visible: boolean;
  onPendingChange(annotation: PendingAnnotation): void;
}

interface ActiveStroke {
  pointerId: number;
  geometry: AnnotationBrushGeometry;
}

function pathData(stroke: AnnotationBrushStroke, dimensions: ImageDimensions) {
  return stroke.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * dimensions.width} ${point.y * dimensions.height}`)
    .join(' ');
}

function strokeWidth(stroke: AnnotationBrushStroke, dimensions: ImageDimensions) {
  return stroke.radius * Math.min(dimensions.width, dimensions.height) * 2;
}

function geometryBounds(geometry: AnnotationBrushGeometry, dimensions: ImageDimensions) {
  const shortEdge = Math.max(1, Math.min(dimensions.width, dimensions.height));
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const stroke of geometry.strokes) {
    if (stroke.mode !== 'ADD') continue;
    const radiusX = (stroke.radius * shortEdge) / Math.max(1, dimensions.width);
    const radiusY = (stroke.radius * shortEdge) / Math.max(1, dimensions.height);
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x - radiusX);
      minY = Math.min(minY, point.y - radiusY);
      maxX = Math.max(maxX, point.x + radiusX);
      maxY = Math.max(maxY, point.y + radiusY);
    }
  }
  const x = Math.max(0, Math.min(1, minX));
  const y = Math.max(0, Math.min(1, minY));
  const right = Math.max(x, Math.min(1, maxX));
  const bottom = Math.max(y, Math.min(1, maxY));
  return { x, y, width: right - x, height: bottom - y };
}

function pendingBrush(geometry: AnnotationBrushGeometry, dimensions: ImageDimensions): PendingAnnotation {
  return { type: 'BRUSH', ...geometryBounds(geometry, dimensions), geometry };
}

function normalizedPoint(event: ReactPointerEvent<SVGSVGElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
  };
}

function BrushMask({
  geometry,
  dimensions,
  id,
  opacity,
}: {
  geometry: AnnotationBrushGeometry;
  dimensions: ImageDimensions;
  id: string;
  opacity: number;
}) {
  const maskId = `brush-mask-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return (
    <>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={dimensions.width} height={dimensions.height}>
          <rect width={dimensions.width} height={dimensions.height} fill="black" />
          {geometry.strokes.map((stroke, index) =>
            stroke.points.length === 1 ? (
              <circle
                key={index}
                cx={stroke.points[0].x * dimensions.width}
                cy={stroke.points[0].y * dimensions.height}
                r={strokeWidth(stroke, dimensions) / 2}
                fill={stroke.mode === 'ADD' ? 'white' : 'black'}
              />
            ) : (
              <path
                key={index}
                d={pathData(stroke, dimensions)}
                fill="none"
                stroke={stroke.mode === 'ADD' ? 'white' : 'black'}
                strokeWidth={strokeWidth(stroke, dimensions)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}
        </mask>
      </defs>
      <rect
        width={dimensions.width}
        height={dimensions.height}
        fill="var(--selected-foreground)"
        fillOpacity={opacity}
        mask={`url(#${maskId})`}
      />
    </>
  );
}

export function BrushAnnotationLayer({
  active,
  annotations,
  brushMode,
  brushRadius,
  dimensions,
  pending,
  selectedId,
  visible,
  onPendingChange,
}: Props) {
  const activeStroke = useRef<ActiveStroke | null>(null);
  const brushAnnotations = annotations.filter(({ annotation }) => annotation.type === 'BRUSH' && annotation.geometry);

  function beginStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (!active || event.button !== 0) return;
    const existing = pending?.type === 'BRUSH' ? pending.geometry : null;
    if (brushMode === 'ERASE' && !existing) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: AnnotationBrushStroke = {
      mode: brushMode,
      radius: brushRadius,
      points: [normalizedPoint(event)],
    };
    const geometry: AnnotationBrushGeometry = {
      version: 1,
      strokes: [...(existing?.strokes ?? []), stroke],
    };
    activeStroke.current = { pointerId: event.pointerId, geometry };
    onPendingChange(pendingBrush(geometry, dimensions));
  }

  function continueStroke(event: ReactPointerEvent<SVGSVGElement>) {
    const activeDrawing = activeStroke.current;
    if (!activeDrawing || activeDrawing.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = normalizedPoint(event);
    const strokes = activeDrawing.geometry.strokes;
    const current = strokes[strokes.length - 1];
    const previous = current.points[current.points.length - 1];
    const dx = (point.x - previous.x) * dimensions.width;
    const dy = (point.y - previous.y) * dimensions.height;
    const minimumDistance = Math.max(1, current.radius * Math.min(dimensions.width, dimensions.height) * 0.2);
    if (dx * dx + dy * dy < minimumDistance * minimumDistance) return;
    const geometry: AnnotationBrushGeometry = {
      version: 1,
      strokes: [...strokes.slice(0, -1), { ...current, points: [...current.points, point] }],
    };
    activeStroke.current = { ...activeDrawing, geometry };
    onPendingChange(pendingBrush(geometry, dimensions));
  }

  function endStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (activeStroke.current?.pointerId !== event.pointerId) return;
    activeStroke.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <svg
      className={cn(
        'absolute inset-0 z-10 size-full touch-none',
        active ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none',
      )}
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      preserveAspectRatio="none"
      onPointerDown={beginStroke}
      onPointerMove={continueStroke}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
    >
      {visible &&
        brushAnnotations.map(({ annotation }) => (
          <BrushMask
            key={annotation.id}
            id={annotation.id}
            geometry={annotation.geometry!}
            dimensions={dimensions}
            opacity={annotation.status !== 'OPEN' ? 0.08 : annotation.id === selectedId ? 0.34 : 0.2}
          />
        ))}
      {pending?.type === 'BRUSH' && pending.geometry && (
        <BrushMask id="pending" geometry={pending.geometry} dimensions={dimensions} opacity={0.32} />
      )}
    </svg>
  );
}
