import { useRef, type PointerEvent, type RefObject, type KeyboardEvent } from 'react';
import type { ImageEditDocument, ImageEditMark } from '@/shared/contracts/image-edit';
import type { ImageEditCanvasProps } from '@/renderer/features/image-editing/image-edit-canvas-types';
import { cropBetween, markBounds, type Point } from '@/renderer/features/image-editing/image-edit-geometry';
import { fitTextHeight } from '@/renderer/features/image-editing/image-edit-text';

type Drag = {
  before: ImageEditDocument;
  start: Point;
  mode: 'draw' | 'move' | 'resize' | 'crop' | 'crop-move';
  id?: string;
  handle?: string;
};

export function useImageEditGesture(
  props: ImageEditCanvasProps,
  group: RefObject<SVGGElement | null>,
  container: RefObject<HTMLDivElement | null>,
  onEditText: (id: string) => void,
) {
  const { document, tool, selected, disabled, original, onChange, onSelect } = props;
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const point = (event: PointerEvent<SVGSVGElement>, clamp = true) => {
    const matrix = group.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return clamp
      ? { x: Math.max(0, Math.min(document.width, p.x)), y: Math.max(0, Math.min(document.height, p.y)) }
      : p;
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (!disabled && tool === 'pan' && event.button === 0 && container.current) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panning.current = {
        x: event.clientX,
        y: event.clientY,
        left: container.current.scrollLeft,
        top: container.current.scrollTop,
      };
      return;
    }
    if (tool === 'pan') return;
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
        width: tool === 'text' ? Math.max(24, Math.min(props.fontSize * 8, document.width - start.x)) : props.fontSize,
        ...(tool === 'text' ? { wrap: true } : {}),
        height: props.fontSize * 1.25,
        color: props.color,
        stroke: props.stroke,
        fontSize: props.fontSize,
        fontFamily: props.fontFamily,
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
      if (tool === 'text') {
        event.currentTarget.releasePointerCapture(event.pointerId);
        onChange({ ...document, marks: [...document.marks, mark] }, false);
        onEditText(mark.id);
        return;
      }
      drag.current = { before: document, start, mode: 'draw', id: mark.id };
      onChange({ ...document, marks: [...document.marks, mark] }, false);
    }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (panning.current && container.current) {
      container.current.scrollLeft = panning.current.left + panning.current.x - event.clientX;
      container.current.scrollTop = panning.current.top + panning.current.y - event.clientY;
      return;
    }
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
              if (mark.kind === 'arrow' || mark.kind === 'line')
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
              const resized = { ...before, ...cropBetween(anchor, end, document) };
              return mark.kind === 'text' ? fitTextHeight({ ...resized, wrap: true }) : resized;
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
    if (panning.current) {
      panning.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onChange(cancel ? active.before : document, !cancel);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      onChange(drag.current.before, false);
      drag.current = null;
    }
  };
  return { down, move, finish, onKeyDown };
}
