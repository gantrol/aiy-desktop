import { useEffect, useRef, useState, type RefObject } from 'react';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  articleCoverAspectRatio,
  articleCoverCropRect,
  type ArticleCoverCrop,
  type ArticleCoverRatio,
} from '@/shared/article-covers';
import { panArticleCover, zoomArticleCover } from '@/renderer/components/creator/article-editor/articleCoverGeometry';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';

export function ArticleCoverCropPreview({
  source,
  ratio,
  crop,
  disabled,
  imageRef,
  onChange,
  onLoad,
  onError,
}: {
  source: VideoDocumentRevisionMediaDto;
  ratio: ArticleCoverRatio;
  crop: ArticleCoverCrop;
  disabled: boolean;
  imageRef: RefObject<HTMLImageElement | null>;
  onChange(crop: ArticleCoverCrop): void;
  onLoad(): void;
  onError(): void;
}) {
  const copy = useI18n().messages.contentEditor.coverEditor;
  const viewportRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; crop: ArticleCoverCrop; scale: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 600, height: 360 });
  const [decodedSize, setDecodedSize] = useState<{ width: number; height: number } | null>(null);
  const width = decodedSize?.width ?? Math.max(1, source.width);
  const height = decodedSize?.height ?? Math.max(1, source.height);
  const rect = articleCoverCropRect(width, height, ratio, crop);
  const aspect = articleCoverAspectRatio(ratio);
  const frameWidth = Math.max(1, Math.min(viewport.width - 40, (viewport.height - 40) * aspect));
  const frameHeight = frameWidth / aspect;
  const left = (viewport.width - frameWidth) / 2;
  const top = (viewport.height - frameHeight) / 2;
  const scale = frameWidth / rect.width;
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const changeZoom = useStableCallback((zoom: number, anchor?: { x: number; y: number }) =>
    onChange(zoomArticleCover(width, height, ratio, crop, zoom, anchor)),
  );
  const handleWheel = useStableCallback((event: WheelEvent) => {
    if (disabled || drag.current || !viewportRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = viewportRef.current.getBoundingClientRect();
    changeZoom(crop.zoom * Math.exp(-event.deltaY * 0.002), {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left - left) / frameWidth)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top - top) / frameHeight)),
    });
  });
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    // React's delegated wheel listener is passive; this crop control owns scrolling.
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);
  return (
    <div className="grid min-w-0 gap-3">
      <Button
        ref={viewportRef}
        type="button"
        variant="ghost"
        aria-label={copy.position}
        title={copy.position}
        disabled={disabled}
        className="relative block h-[min(48dvh,24rem)] min-h-48 w-full touch-none cursor-grab overflow-hidden rounded-sm bg-surface-sunken p-0 hover:bg-surface-sunken active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, crop, scale };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointerId !== event.pointerId) return;
          onChange(
            panArticleCover(
              width,
              height,
              ratio,
              start.crop,
              (event.clientX - start.x) / start.scale,
              (event.clientY - start.y) / start.scale,
            ),
          );
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const delta = (event.shiftKey ? 20 : 4) / scale;
          if (['+', '=', '-'].includes(event.key)) {
            event.preventDefault();
            changeZoom(crop.zoom + (event.key === '-' ? -0.1 : 0.1));
          } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            onChange(
              panArticleCover(
                width,
                height,
                ratio,
                crop,
                event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0,
                event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0,
              ),
            );
          }
        }}
      >
        <img
          key={source.assetId}
          ref={imageRef}
          src={source.mediaUrl}
          crossOrigin="anonymous"
          alt=""
          draggable={false}
          onLoad={(event) => {
            setDecodedSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
            onLoad();
          }}
          onError={onError}
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            width: width * scale,
            height: height * scale,
            left: left - rect.x * scale,
            top: top - rect.y * scale,
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 bg-black/55"
          style={{ height: top }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
          style={{ height: top }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 bg-black/55"
          style={{ top, width: left, height: frameHeight }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bg-black/55"
          style={{ top, width: left, height: frameHeight }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute border border-white/90"
          style={{ left, top, width: frameWidth, height: frameHeight }}
        >
          <span className="absolute inset-x-0 top-1/3 h-1/3 border-y border-white/45" />
          <span className="absolute inset-y-0 left-1/3 w-1/3 border-x border-white/45" />
        </span>
      </Button>
      <div className="flex items-center gap-3">
        <MinusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Slider
          aria-label={copy.zoom}
          disabled={disabled}
          min={1}
          max={4}
          step={0.01}
          value={[crop.zoom]}
          onValueChange={([value]) => changeZoom(value)}
        />
        <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
          {Math.round(crop.zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
