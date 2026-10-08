import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { ImageEditDocument, ImageEditMark } from '@/shared/contracts/image-edit';
import { ImageEditMarks } from '@/renderer/features/image-editing/ImageEditMarks';
import {
  cropBetween,
  cornerHandles,
  imageViewport,
  markBounds,
  type ImageEditTool,
  type Point,
} from '@/renderer/features/image-editing/image-edit-geometry';

interface Props {
  document: ImageEditDocument;
  sourceUrl: string;
  tool: ImageEditTool;
  selected: string | null;
  color: string;
  stroke: number;
  fontSize: number;
  zoom: number | null;
  disabled: boolean;
  original: boolean;
  label: string;
  onSelect(id: string | null): void;
  onChange(document: ImageEditDocument, commit?: boolean): void;
}
type Drag = {
  before: ImageEditDocument;
  start: Point;
  mode: 'draw' | 'move' | 'resize' | 'crop' | 'crop-move';
  id?: string;
  handle?: string;
};

function useHandleSize(group: RefObject<SVGGElement | null>, width: number, height: number, zoom: number | null) {
  const [size, setSize] = useState(12);
  useEffect(() => {
    const svg = group.current?.ownerSVGElement;
    if (!svg) return;
    const update = () => {
      const matrix = group.current?.getScreenCTM();
      const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
      if (scale > 0) setSize(12 / scale);
    };
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    update();
    return () => observer.disconnect();
  }, [group, width, height, zoom]);
  useEffect(() => {
    group.current?.ownerSVGElement?.focus();
  }, [group]);
  return size;
}

export function ImageEditCanvas(props: Props) {
  const { document, sourceUrl, tool, selected, disabled, original, onChange, onSelect } = props;
  const group = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const visible = original
    ? {
        ...document,
        crop: { x: 0, y: 0, width: document.width, height: document.height },
        marks: [],
        rotation: 0,
        flipX: false,
        flipY: false,
      }
    : document;
  const viewport = imageViewport(visible, tool === 'crop');
  const handleSize = useHandleSize(group, viewport.width, viewport.height, props.zoom);
  const point = (event: PointerEvent<SVGSVGElement>, clamp = true) => {
    const matrix = group.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return clamp
      ? { x: Math.max(0, Math.min(document.width, p.x)), y: Math.max(0, Math.min(document.height, p.y)) }
      : p;
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || original || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event, false),
      target = event.target as Element;
    if (start.x < 0 || start.y < 0 || start.x > document.width || start.y > document.height) return;
    const id = target.closest('[data-mark]')?.getAttribute('data-mark');
    const handle = target.getAttribute('data-handle') ?? undefined;
    if (tool === 'crop') {
      drag.current = { before: document, start, mode: target.hasAttribute('data-crop') ? 'crop-move' : 'crop', handle };
    } else if (id || handle) {
      onSelect(id ?? selected);
      drag.current = {
        before: document,
        start,
        mode: handle ? 'resize' : 'move',
        id: id ?? selected ?? undefined,
        handle,
      };
    } else if (tool === 'select') onSelect(null);
    else {
      if (document.marks.length >= 300) return;
      const mark: ImageEditMark = {
        id: crypto.randomUUID(),
        kind: tool,
        x: start.x,
        y: start.y,
        width: tool === 'text' ? props.fontSize * 8 : props.fontSize,
        height: props.fontSize * 1.25,
        color: props.color,
        stroke: props.stroke,
        fontSize: props.fontSize,
        text:
          tool === 'number'
            ? String(
                document.marks
                  .filter((m) => m.kind === 'number')
                  .reduce((max, m) => Math.max(max, Number(m.text) || 0), 0) + 1,
              )
            : '',
        ...(tool === 'pen' ? { points: [{ x: 0, y: 0 }] } : {}),
      };
      onSelect(mark.id);
      drag.current = { before: document, start, mode: 'draw', id: mark.id };
      onChange({ ...document, marks: [...document.marks, mark] }, false);
    }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || original) return;
    const active = drag.current;
    if (!active) return;
    const end = point(event),
      dx = end.x - active.start.x,
      dy = end.y - active.start.y;
    if (active.mode === 'crop-move') {
      const crop = active.before.crop;
      onChange(
        {
          ...document,
          crop: {
            ...crop,
            x: Math.round(Math.max(0, Math.min(document.width - crop.width, crop.x + dx))),
            y: Math.round(Math.max(0, Math.min(document.height - crop.height, crop.y + dy))),
          },
        },
        false,
      );
    } else if (active.mode === 'crop') {
      const box = active.before.crop;
      const anchor = active.handle
        ? {
            x: active.handle.includes('w') ? box.x + box.width : box.x,
            y: active.handle.includes('n') ? box.y + box.height : box.y,
          }
        : active.start;
      onChange({ ...document, crop: cropBetween(anchor, end, document) }, false);
    } else {
      onChange(
        {
          ...document,
          marks: document.marks.map((mark) => {
            if (mark.id !== active.id) return mark;
            const before = active.before.marks.find((m) => m.id === mark.id) ?? mark;
            if (active.mode === 'move') return { ...before, x: before.x + dx, y: before.y + dy };
            if (active.mode === 'resize') {
              if (mark.kind === 'arrow')
                return active.handle === 'start'
                  ? {
                      ...before,
                      x: end.x,
                      y: end.y,
                      width: before.x + before.width - end.x,
                      height: before.y + before.height - end.y,
                    }
                  : { ...before, width: end.x - before.x, height: end.y - before.y };
              const box = markBounds(before);
              const anchor = {
                x: active.handle?.includes('w') ? box.x + box.width : box.x,
                y: active.handle?.includes('n') ? box.y + box.height : box.y,
              };
              return { ...before, ...cropBetween(anchor, end, document) };
            }
            if (mark.kind === 'text' || mark.kind === 'number') return mark;
            if (mark.kind === 'pen') {
              const points = mark.points ?? [],
                last = points.at(-1);
              if (points.length >= 2000 || (last && Math.hypot(dx - last.x, dy - last.y) < 1)) return mark;
              return { ...mark, points: [...points, { x: dx, y: dy }] };
            }
            return { ...mark, width: dx, height: dy };
          }),
        },
        false,
      );
    }
  };
  const finish = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onChange(cancel ? active.before : document, !cancel);
  };
  const selectedMark = document.marks.find((mark) => mark.id === selected);
  const box = tool === 'crop' ? document.crop : selectedMark ? markBounds(selectedMark) : null;
  const handles = cornerHandles(box);
  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-muted/40 p-2">
      <svg
        tabIndex={0}
        role="img"
        aria-label={props.label}
        className="m-auto shrink-0 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          width: props.zoom ? viewport.width * props.zoom : '100%',
          height: props.zoom ? viewport.height * props.zoom : '100%',
          minHeight: props.zoom ? undefined : 80,
          cursor: disabled ? 'wait' : tool === 'select' ? 'default' : 'crosshair',
        }}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => finish(e)}
        onPointerCancel={(e) => finish(e, true)}
        onLostPointerCapture={(e) => finish(e, true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && drag.current) {
            event.stopPropagation();
            onChange(drag.current.before, false);
            drag.current = null;
          }
        }}
      >
        <defs>
          <pattern id="edit-alpha" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" className="fill-media-checker-a" />
            <path d="M0 0H8V8H0ZM8 8H16V16H8Z" className="fill-media-checker-b" />
          </pattern>
        </defs>
        <rect width={viewport.width} height={viewport.height} fill="url(#edit-alpha)" />
        <g ref={group} transform={`matrix(${viewport.matrix.join(' ')})`}>
          <image href={sourceUrl} x={0} y={0} width={document.width} height={document.height} pointerEvents="none" />
          <ImageEditMarks marks={visible.marks} />
          {!original && tool === 'crop' && (
            <>
              <path
                d={`M0 0H${document.width}V${document.height}H0Z M${document.crop.x} ${document.crop.y}v${document.crop.height}h${document.crop.width}v-${document.crop.height}Z`}
                className="fill-media-surround-dark"
                opacity=".45"
                fillRule="evenodd"
                pointerEvents="none"
              />
              <rect
                {...document.crop}
                data-crop="true"
                fill="transparent"
                className="stroke-background"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          {!original && box && (
            <g className="fill-background stroke-foreground" strokeWidth="1.5">
              {tool !== 'crop' && <rect {...box} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
              {(tool === 'crop' || (selectedMark && ['rectangle', 'cover', 'highlight'].includes(selectedMark.kind))) &&
                handles.map(([name, x, y]) => (
                  <rect
                    key={name}
                    data-handle={name}
                    x={x - handleSize / 2}
                    y={y - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              {selectedMark?.kind === 'arrow' &&
                tool !== 'crop' &&
                [
                  ['start', selectedMark.x, selectedMark.y],
                  ['end', selectedMark.x + selectedMark.width, selectedMark.y + selectedMark.height],
                ].map(([name, x, y]) => (
                  <circle
                    key={name}
                    data-handle={name}
                    cx={x}
                    cy={y}
                    r={handleSize / 2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
