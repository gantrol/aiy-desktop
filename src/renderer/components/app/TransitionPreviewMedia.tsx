import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { TransitionPreviewDto } from '@/shared/contracts/local-space';
import { cn } from '@/renderer/lib/utils';
import './TransitionPreviewMedia.css';

const MIN_TRANSITION_PREVIEW_ASPECT = 0.5;
const MAX_TRANSITION_PREVIEW_ASPECT = 2;
const TRANSITION_PREVIEW_RETRY_DELAYS_MS = [180, 540] as const;

export type TransitionPreviewMediaState = 'ready' | 'loading' | 'error';

interface Props {
  preview: TransitionPreviewDto | null;
  requested: boolean;
  mediaState?: TransitionPreviewMediaState;
  className?: string;
  imageClassName?: string;
  placeholder?: ReactNode;
}

interface RetryState {
  identity: string;
  attempt: number;
}

interface RetriedImageSource {
  sourceUrl: string | null;
  loaded: boolean;
  failed: boolean;
  markLoaded(sourceUrl?: string): void;
  markFailed(sourceUrl?: string): void;
}

interface PreviewImageLayersProps {
  preview: TransitionPreviewDto;
  thumbnail: RetriedImageSource;
  detail: RetriedImageSource;
  distinctDetail: boolean;
  mediaEnabled: boolean;
  imageClassName?: string;
}

export function clampTransitionPreviewAspect(width: number, height: number) {
  const aspect = width / height;
  if (!Number.isFinite(aspect) || aspect <= 0) return 0.75;
  return Math.max(MIN_TRANSITION_PREVIEW_ASPECT, Math.min(MAX_TRANSITION_PREVIEW_ASPECT, aspect));
}

function transitionPreviewNeedsEdgeFill(width: number, height: number) {
  const aspect = width / height;
  return (
    Number.isFinite(aspect) &&
    aspect > 0 &&
    (aspect < MIN_TRANSITION_PREVIEW_ASPECT || aspect > MAX_TRANSITION_PREVIEW_ASPECT)
  );
}

function transitionPreviewAttemptUrl(url: string, attempt: number) {
  if (attempt === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}load-attempt=${attempt}`;
}

function useRetriedImageSource(identity: string, enabled: boolean): RetriedImageSource {
  // Keep terminal states tied to the exact attempted URL. Never reset a
  // generic status from an effect: cached media can finish before that effect.
  const [retryState, setRetryState] = useState<RetryState>({ identity, attempt: 0 });
  const [loadedSourceUrl, setLoadedSourceUrl] = useState<string | null>(null);
  const [failedSourceUrl, setFailedSourceUrl] = useState<string | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  useEffect(() => clearRetryTimer, [clearRetryTimer, enabled, identity]);

  const attempt = retryState.identity === identity ? retryState.attempt : 0;
  const sourceUrl = enabled && identity ? transitionPreviewAttemptUrl(identity, attempt) : null;
  const currentSourceUrlRef = useRef(sourceUrl);
  currentSourceUrlRef.current = sourceUrl;
  const loaded = sourceUrl !== null && loadedSourceUrl === sourceUrl;
  const failed = sourceUrl !== null && failedSourceUrl === sourceUrl;
  const markLoaded = useCallback(
    (completedSourceUrl = sourceUrl ?? '') => {
      if (!completedSourceUrl || currentSourceUrlRef.current !== completedSourceUrl) return;
      clearRetryTimer();
      setFailedSourceUrl((current) => (current === completedSourceUrl ? null : current));
      setLoadedSourceUrl(completedSourceUrl);
    },
    [clearRetryTimer, sourceUrl],
  );
  const markFailed = useCallback(
    (completedSourceUrl = sourceUrl ?? '') => {
      if (!completedSourceUrl || currentSourceUrlRef.current !== completedSourceUrl) return;
      const delay = TRANSITION_PREVIEW_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        setFailedSourceUrl(completedSourceUrl);
        return;
      }
      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        if (currentSourceUrlRef.current !== completedSourceUrl) return;
        setRetryState({ identity, attempt: attempt + 1 });
      }, delay);
    },
    [attempt, clearRetryTimer, identity, sourceUrl],
  );

  return { sourceUrl, loaded, failed, markLoaded, markFailed };
}

function internalPreviewLoadState(
  preview: TransitionPreviewDto | null,
  requested: boolean,
  thumbnail: RetriedImageSource,
) {
  if (!preview) return 'placeholder';
  if (!requested) return 'idle';
  if (thumbnail.failed) return 'error';
  return thumbnail.loaded ? 'loaded' : 'loading';
}

function markLoadedAfterDecode(image: HTMLImageElement, source: RetriedImageSource, completedSourceUrl: string) {
  const complete = () => {
    if (image.complete && image.naturalWidth > 0) source.markLoaded(completedSourceUrl);
    else source.markFailed(completedSourceUrl);
  };
  if (typeof image.decode !== 'function') {
    complete();
    return;
  }
  void image.decode().then(complete, complete);
}

function PreviewImageLayers({
  preview,
  thumbnail,
  detail,
  distinctDetail,
  mediaEnabled,
  imageClassName,
}: PreviewImageLayersProps) {
  return (
    <>
      {thumbnail.sourceUrl && mediaEnabled && !thumbnail.failed && (
        <img
          key={thumbnail.sourceUrl}
          className={cn(
            'absolute inset-0 z-[2] block size-full bg-transparent object-contain transition-[opacity,filter,transform] duration-overlay ease-enter',
            thumbnail.loaded
              ? distinctDetail && !detail.failed
                ? 'opacity-100 blur-[1.5px] scale-[1.015]'
                : 'opacity-100 blur-0 scale-100'
              : 'opacity-0 blur-[3px] scale-[1.03]',
            distinctDetail && detail.loaded && 'opacity-0 blur-0 scale-100',
            imageClassName,
          )}
          src={thumbnail.sourceUrl}
          width={preview.width}
          height={preview.height}
          alt=""
          loading="eager"
          decoding="async"
          draggable={false}
          onLoad={(event) => markLoadedAfterDecode(event.currentTarget, thumbnail, thumbnail.sourceUrl ?? '')}
          onError={(event) => {
            event.currentTarget.hidden = true;
            thumbnail.markFailed(thumbnail.sourceUrl ?? '');
          }}
        />
      )}
      {distinctDetail && detail.sourceUrl && !detail.failed && (
        <img
          key={detail.sourceUrl}
          className={cn(
            'absolute inset-0 z-[3] block size-full bg-transparent object-contain opacity-0 transition-opacity duration-overlay ease-enter',
            detail.loaded && 'opacity-100',
            imageClassName,
          )}
          src={detail.sourceUrl}
          width={preview.width}
          height={preview.height}
          alt=""
          loading="eager"
          fetchPriority="low"
          decoding="async"
          draggable={false}
          onLoad={(event) => markLoadedAfterDecode(event.currentTarget, detail, detail.sourceUrl ?? '')}
          onError={(event) => {
            event.currentTarget.hidden = true;
            detail.markFailed(detail.sourceUrl ?? '');
          }}
        />
      )}
    </>
  );
}

function TransitionPreviewBackdrop({ sourceUrl }: { sourceUrl: string }) {
  const filterId = `transition-preview-blur-${useId().replaceAll(':', '')}`;
  return (
    <svg
      aria-hidden="true"
      data-transition-preview-backdrop
      className="pointer-events-none absolute inset-0 z-[1] size-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <filter id={filterId} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" edgeMode="duplicate" />
        </filter>
      </defs>
      <image href={sourceUrl} width="100" height="100" preserveAspectRatio="none" filter={`url(#${filterId})`} />
    </svg>
  );
}

function TransitionPreviewPlaceholder() {
  return (
    <span
      aria-hidden="true"
      data-transition-preview-placeholder
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-media-surround-dark"
    >
      <span className="absolute -left-1/4 top-[34%] h-[38%] w-[150%] -rotate-[32deg] bg-media-surround" />
      <span className="absolute -bottom-1/4 -left-[12%] h-[48%] w-[145%] -rotate-[24deg] bg-selected-foreground" />
      <span className="absolute right-[16%] top-[14%] size-[18%] rounded-full bg-selected-foreground" />
    </span>
  );
}

export const TransitionPreviewMedia = forwardRef<HTMLSpanElement, Props>(function TransitionPreviewMedia(
  {
    preview,
    requested,
    mediaState = 'ready',
    className,
    imageClassName,
    placeholder = <TransitionPreviewPlaceholder />,
  },
  ref,
) {
  const detailUrl = preview?.detailUrl ?? preview?.url ?? '';
  const mediaEnabled = mediaState === 'ready' && requested;
  const thumbnail = useRetriedImageSource(preview?.url ?? '', mediaEnabled);
  const distinctDetail = Boolean(preview && detailUrl !== preview.url);
  // Chain each detail request after its thumbnail and give it low fetch
  // priority, preserving first useful pixels for newly admitted frames.
  const detail = useRetriedImageSource(detailUrl, mediaEnabled && thumbnail.loaded && distinctDetail);
  const detailLoaded = distinctDetail ? detail.loaded : thumbnail.loaded;
  const internalState = internalPreviewLoadState(preview, requested, thumbnail);
  const loadState = mediaState === 'ready' ? internalState : mediaState;
  const needsEdgeFill = preview ? transitionPreviewNeedsEdgeFill(preview.width, preview.height) : false;
  const visibleSourceUrl = detailLoaded && distinctDetail ? detail.sourceUrl : thumbnail.sourceUrl;

  return (
    <span
      ref={ref}
      className={cn('absolute inset-0 isolate overflow-hidden rounded-[inherit]', className)}
      data-preview-load={loadState}
      data-preview-quality={
        loadState === 'loaded' ? (distinctDetail && detail.loaded ? 'detail' : 'thumbnail') : undefined
      }
      data-preview-edge-fill={needsEdgeFill ? 'true' : undefined}
    >
      {placeholder}
      {loadState === 'loaded' && needsEdgeFill && visibleSourceUrl && (
        <TransitionPreviewBackdrop sourceUrl={visibleSourceUrl} />
      )}
      {preview && (
        <PreviewImageLayers
          preview={preview}
          thumbnail={thumbnail}
          detail={detail}
          distinctDetail={distinctDetail}
          mediaEnabled={mediaEnabled}
          imageClassName={imageClassName}
        />
      )}
    </span>
  );
});
