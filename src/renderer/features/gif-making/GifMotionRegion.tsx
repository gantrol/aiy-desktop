import { useRef, type PointerEvent, type KeyboardEvent } from 'react';
import type { AssetDto } from '@/shared/contracts';
import type { GifMotionRegion } from '@/shared/contracts/gif-generation';

const bound = (v: number) => Math.max(0, Math.min(1, v));
export function GifMotionRegionEditor({
  source,
  region,
  onChange,
  disabled,
  label,
}: {
  source: AssetDto;
  region: GifMotionRegion | null;
  onChange(region: GifMotionRegion | null): void;
  disabled: boolean;
  label: string;
}) {
  const drag = useRef<{ x: number; y: number; region: GifMotionRegion | null } | null>(null);
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const result = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: bound(result.x / source.width), y: bound(result.y / source.height) };
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || disabled) return;
    const p = point(event),
      start = drag.current;
    if (start.region) {
      onChange({
        ...start.region,
        x: Math.max(0, Math.min(1 - start.region.width, start.region.x + p.x - start.x)),
        y: Math.max(0, Math.min(1 - start.region.height, start.region.y + p.y - start.y)),
      });
    } else {
      const width = Math.abs(p.x - start.x),
        height = Math.abs(p.y - start.y);
      if (width >= 0.005 && height >= 0.005)
        onChange({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width, height });
    }
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    if (!region) {
      if (event.key === 'Enter') {
        event.preventDefault();
        onChange({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onChange(null);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === 'ArrowLeft' ? -0.005 : event.key === 'ArrowRight' ? 0.005 : 0;
    const dy = event.key === 'ArrowUp' ? -0.005 : event.key === 'ArrowDown' ? 0.005 : 0;
    onChange(
      event.shiftKey
        ? {
            ...region,
            width: Math.max(0.005, Math.min(1 - region.x, region.width + dx)),
            height: Math.max(0.005, Math.min(1 - region.y, region.height + dy)),
          }
        : {
            ...region,
            x: Math.max(0, Math.min(1 - region.width, region.x + dx)),
            y: Math.max(0, Math.min(1 - region.height, region.y + dy)),
          },
    );
  };
  return (
    <svg
      viewBox={`0 0 ${source.width} ${source.height}`}
      width={source.width}
      height={source.height}
      className="max-h-full max-w-full touch-none select-none"
      tabIndex={disabled ? -1 : 0}
      role="group"
      aria-label={label}
      onKeyDown={key}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const p = point(event),
          inside =
            region &&
            p.x >= region.x &&
            p.x <= region.x + region.width &&
            p.y >= region.y &&
            p.y <= region.y + region.height;
        drag.current = { ...p, region: inside ? region : null };
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        move(event);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <image href={source.mediaUrl} width={source.width} height={source.height} />
      {region && (
        <rect
          x={region.x * source.width}
          y={region.y * source.height}
          width={region.width * source.width}
          height={region.height * source.height}
          fill="currentColor"
          fillOpacity="0.12"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
      )}
    </svg>
  );
}
