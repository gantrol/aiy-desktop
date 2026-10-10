import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ImageEditCanvasProps } from '@/renderer/features/image-editing/image-edit-canvas-types';
import { ImageEditText } from '@/renderer/features/image-editing/ImageEditText';
import { ImageEditOverlay } from '@/renderer/features/image-editing/ImageEditOverlay';
import { useImageEditGesture } from '@/renderer/features/image-editing/use-image-edit-gesture';
import { ImageEditMarks } from '@/renderer/features/image-editing/ImageEditMarks';
import { ImageEditRasterPreview } from '@/renderer/features/image-editing/ImageEditRasterPreview';
import { imageViewport, markBounds } from '@/renderer/features/image-editing/image-edit-geometry';
import { ImageEditHandles } from '@/renderer/features/image-editing/ImageEditHandles';

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

export function ImageEditCanvas(props: ImageEditCanvasProps) {
  const { document, sourceUrl, tool, selected, disabled, original, onChange, onSelect } = props;
  const group = useRef<SVGGElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const text =
    !original && !disabled && selected === editingText
      ? document.marks.find((mark) => mark.id === editingText && ['text', 'number'].includes(mark.kind))
      : undefined;
  const finishText = (focus = false) => {
    if (!text) return;
    onChange({ ...document, marks: document.marks.filter((mark) => mark.id !== text.id || mark.text.trim()) });
    setEditingText(null);
    if (focus) group.current?.ownerSVGElement?.focus();
  };
  const { down, move, finish, onKeyDown } = useImageEditGesture(props, group, container, setEditingText);
  const visible = original
    ? {
        ...document,
        crop: { x: 0, y: 0, width: document.width, height: document.height },
        marks: [],
        rotation: 0,
        flipX: false,
        flipY: false,
      }
    : text
      ? { ...document, marks: document.marks.filter((mark) => mark.id !== text.id) }
      : document;
  const viewport = imageViewport(visible, tool === 'crop');
  const raster = !original && visible.marks.some((mark) => mark.kind === 'mosaic' || mark.kind === 'blur');
  const handleSize = useHandleSize(group, viewport.width, viewport.height, props.zoom);
  const selectedMark = document.marks.find((mark) => mark.id === selected);
  const box = tool === 'crop' ? document.crop : selectedMark ? markBounds(selectedMark) : null;
  return (
    <div className="relative flex min-h-0 flex-1">
      <div ref={container} className="flex min-h-0 flex-1 overflow-auto bg-muted/40 p-2">
        <svg
          tabIndex={0}
          role="img"
          aria-label={props.label}
          className="m-auto shrink-0 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            width: props.zoom ? viewport.width * props.zoom : '100%',
            height: props.zoom ? viewport.height * props.zoom : '100%',
            minHeight: props.zoom ? undefined : 80,
            cursor: disabled ? 'wait' : tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
          }}
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
          onLostPointerCapture={(e) => finish(e, true)}
          onKeyDown={onKeyDown}
          onDoubleClick={(event) => {
            if (disabled || original) return;
            const id = (event.target as Element).closest('[data-mark]')?.getAttribute('data-mark');
            if (id && document.marks.some((mark) => mark.id === id && ['text', 'number'].includes(mark.kind))) {
              onSelect(id);
              setEditingText(id);
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
            {raster && (
              <>
                <ImageEditRasterPreview image={props.image} document={visible} onError={props.onRasterError} />
                <g opacity={0}>
                  <ImageEditMarks marks={visible.marks} />
                </g>
              </>
            )}
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
            {!original && box && <ImageEditHandles box={box} tool={tool} selected={selectedMark} size={handleSize} />}
            {text && (
              <ImageEditText
                key={text.id}
                mark={text}
                label={props.label}
                onComposing={props.onComposing}
                onFinish={finishText}
                onChange={(value) =>
                  props.onTextChange({
                    ...document,
                    marks: document.marks.map((mark) => (mark.id === value.id ? value : mark)),
                  })
                }
              />
            )}
          </g>
        </svg>
      </div>
      {!original && props.parameters && (
        <ImageEditOverlay group={group} container={container} box={box}>
          {props.parameters}
        </ImageEditOverlay>
      )}
    </div>
  );
}
