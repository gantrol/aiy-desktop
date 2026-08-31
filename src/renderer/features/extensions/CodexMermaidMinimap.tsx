import { useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@/renderer/components/ui/button';

export interface MermaidViewportGeometry {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
}

interface Props {
  src: string;
  label: string;
  geometry: MermaidViewportGeometry;
  zoom: number;
  pan: { x: number; y: number };
  onNavigate(point: { x: number; y: number }): void;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function visibleAxis(viewportSize: number, imageSize: number, zoom: number, pan: number) {
  const scaledSize = imageSize * zoom;
  if (scaledSize <= 0) return { start: 0, size: 1 };
  const imageStart = (viewportSize - scaledSize) / 2 + pan;
  const start = clamp(-imageStart / scaledSize, 0, 1);
  const end = clamp((viewportSize - imageStart) / scaledSize, 0, 1);
  return { start, size: Math.max(0, end - start) };
}

export function CodexMermaidMinimap({ src, label, geometry, zoom, pan, onNavigate }: Props) {
  const previewRef = useRef<HTMLSpanElement>(null);
  const horizontal = visibleAxis(geometry.viewportWidth, geometry.imageWidth, zoom, pan.x);
  const vertical = visibleAxis(geometry.viewportHeight, geometry.imageHeight, zoom, pan.y);
  const aspectRatio = geometry.imageWidth / geometry.imageHeight;
  const previewStyle: CSSProperties =
    aspectRatio >= 1.5
      ? { width: '100%', aspectRatio: String(aspectRatio) }
      : { height: '100%', aspectRatio: String(aspectRatio) };

  function navigate(event: ReactMouseEvent<HTMLButtonElement>) {
    const bounds = previewRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    onNavigate({
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      aria-label={label}
      title={label}
      className="absolute right-4 top-4 z-10 h-24 w-36 overflow-hidden bg-background/95 p-1 shadow-overlay"
      onClick={navigate}
    >
      <span ref={previewRef} className="pointer-events-none relative block overflow-hidden" style={previewStyle}>
        <img
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 size-full object-fill opacity-75"
        />
        <span
          aria-hidden="true"
          className="absolute min-h-1 min-w-1 border-2 border-foreground bg-background/20"
          style={{
            left: `${horizontal.start * 100}%`,
            top: `${vertical.start * 100}%`,
            width: `${horizontal.size * 100}%`,
            height: `${vertical.size * 100}%`,
          }}
        />
      </span>
    </Button>
  );
}
