import { useEffect, useRef, useState, type ComponentPropsWithRef, type PointerEvent, type ReactNode } from 'react';
import { EyeOffIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  imageAssetIdFromUrl,
  useImageHidden,
  useImageVisibility,
} from '@/renderer/components/media/ImageVisibilityProvider';
import { createScratchSurface } from '@/renderer/components/media/scratchSurface';
import scratchCoatingUrl from '@/renderer/components/media/scratch-coating.svg?url';

type ImageProps = ComponentPropsWithRef<'img'> & { assetId?: string; onRevealed?(): void };

function ScratchCover({ onReveal }: { onReveal(): void }) {
  const copy = useI18n().messages.assetFile;
  const visibility = useImageVisibility();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coatingRef = useRef<HTMLImageElement>(null);
  const surface = useRef<ReturnType<typeof createScratchSurface>>(null);
  const pointer = useRef<number | null>(null);
  const [started, setStarted] = useState(false);
  const ready = visibility?.ready ?? true;
  const retry = !ready && visibility?.loadFailed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      surface.current = null;
      pointer.current = null;
      canvas.parentElement?.removeAttribute('data-scratched');
      setStarted(false);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  function scratch(event: PointerEvent<HTMLElement>) {
    if (pointer.current !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      surface.current?.scratch({
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      })
    ) {
      // Consume the release click before unmounting, so it cannot activate the image underneath.
      event.currentTarget.dataset.scratched = 'true';
    }
  }

  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        '@container/scratch-cover pointer-events-auto absolute inset-0 z-20 size-full touch-none cursor-crosshair select-none overflow-hidden rounded-none p-0 text-media-surround-dark hover:bg-transparent focus-visible:ring-inset',
        !started && 'bg-media-surround-light hover:bg-media-surround-light',
        retry && 'cursor-pointer',
      )}
    >
      <span
        role="button"
        tabIndex={0}
        aria-disabled={!ready && !retry}
        aria-label={retry ? copy.visibilityRetry : ready ? copy.scratchKeyboard : copy.visibilityLoading}
        data-image-scratch-cover
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (retry) visibility?.retry();
          if (ready && event.currentTarget.dataset.scratched === 'true') onReveal();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          if (retry) visibility?.retry();
          else if (ready) onReveal();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          if (!ready || pointer.current !== null) return;
          const canvas = canvasRef.current;
          const rect = event.currentTarget.getBoundingClientRect();
          if (!canvas || !rect.width || !rect.height) return;
          const coating = coatingRef.current;
          surface.current ??= createScratchSurface(
            canvas,
            rect.width,
            rect.height,
            coating?.complete && coating.naturalWidth > 0 ? coating : undefined,
          );
          if (!surface.current) return;
          delete event.currentTarget.dataset.scratched;
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          setStarted(true);
          scratch(event);
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          scratch(event);
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          scratch(event);
          pointer.current = null;
          surface.current?.end();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          pointer.current = null;
          surface.current?.end();
          delete event.currentTarget.dataset.scratched;
        }}
        onLostPointerCapture={() => {
          pointer.current = null;
          surface.current?.end();
        }}
      >
        <img
          ref={coatingRef}
          src={scratchCoatingUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={cn('pointer-events-none absolute inset-0 size-full object-fill', started && 'invisible')}
        />
        <canvas
          ref={canvasRef}
          width={1}
          height={1}
          aria-hidden="true"
          className={cn('pointer-events-none absolute inset-0 size-full', !started && 'invisible')}
        />
        {!started && (
          <span
            aria-hidden="true"
            className="pointer-events-none relative flex max-w-full flex-col items-center gap-2 px-2"
          >
            {retry ? (
              <RotateCcwIcon className="size-4" strokeWidth={1.5} />
            ) : (
              <EyeOffIcon className="size-4 @[128px]/scratch-cover:size-5" strokeWidth={1.5} />
            )}
            <span className="hidden max-w-full truncate text-xs font-medium tracking-wide @[96px]/scratch-cover:block">
              {retry ? copy.visibilityRetry : ready ? copy.scratch : copy.hiddenImage}
            </span>
          </span>
        )}
      </span>
    </Button>
  );
}

function useTemporaryImageReveal() {
  const [revealed, setRevealed] = useState(false);
  const [coverRevision, setCoverRevision] = useState(0);
  const frame = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const conceal = () => {
      setRevealed(false);
      setCoverRevision((current) => current + 1);
    };
    const onVisibility = () => {
      if (document.hidden) conceal();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) conceal();
    });
    if (frame.current) observer.observe(frame.current);
    return () => {
      conceal();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return { revealed, setRevealed, frame, coverRevision };
}

function ConcealedImage({ className, style, onRevealed, ...props }: Omit<ImageProps, 'assetId'>) {
  const { revealed, setRevealed, frame, coverRevision } = useTemporaryImageReveal();
  return (
    <span
      ref={frame}
      tabIndex={-1}
      data-image-concealed={!revealed || undefined}
      className={cn('relative inline-grid overflow-hidden align-middle', className)}
      style={style}
    >
      <img
        {...props}
        aria-hidden={!revealed || props['aria-hidden']}
        draggable={revealed && props.draggable}
        className="col-start-1 row-start-1 block size-full min-h-0 min-w-0 object-contain"
        style={{
          maxHeight: 'inherit',
          maxWidth: 'inherit',
          objectFit: 'inherit',
          objectPosition: 'inherit',
        }}
      />
      {!revealed && (
        <ScratchCover
          key={coverRevision}
          onReveal={() => {
            if (frame.current?.contains(document.activeElement)) frame.current.focus({ preventScroll: true });
            setRevealed(true);
            onRevealed?.();
          }}
        />
      )}
    </span>
  );
}

/** Keeps the existing image element and load/error contract; only hidden assets gain a scratch surface. */
export function ScratchImage({ assetId, onRevealed, ...props }: ImageProps) {
  const id = assetId ?? imageAssetIdFromUrl(props.src);
  const hidden = useImageHidden(id);
  return hidden ? <ConcealedImage key={id} onRevealed={onRevealed} {...props} /> : <img {...props} />;
}

function ConcealedSurface({ asset, className, children }: SurfaceProps) {
  const { revealed, setRevealed, frame, coverRevision } = useTemporaryImageReveal();
  return (
    <span ref={frame} tabIndex={-1} className={cn('relative block min-h-0 min-w-0 overflow-hidden', className)}>
      {revealed ? (
        children
      ) : (
        <ScratchImage
          key={coverRevision}
          assetId={asset.id}
          src={asset.mediaUrl}
          alt=""
          className="size-full object-contain"
          onRevealed={() => {
            if (frame.current?.contains(document.activeElement)) frame.current.focus({ preventScroll: true });
            setRevealed(true);
          }}
        />
      )}
    </span>
  );
}

interface SurfaceProps {
  asset: { id: string; mediaUrl: string };
  className?: string;
  children: ReactNode;
}

/** Image editors keep their original DOM/ref and receive input only after explicit reveal. */
export function ScratchImageBoundary(props: SurfaceProps) {
  const hidden = useImageHidden(props.asset.id);
  return hidden ? <ConcealedSurface key={props.asset.id} {...props} /> : props.children;
}
