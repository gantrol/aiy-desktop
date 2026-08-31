import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { AssetDto } from '@/shared/contracts';

type MediaAsset = Pick<AssetDto, 'mediaUrl' | 'mimeType'>;
type MediaElement = HTMLImageElement | HTMLVideoElement;

export function isVideoAsset(asset: Pick<AssetDto, 'mimeType'> | null | undefined) {
  return Boolean(asset?.mimeType.startsWith('video/'));
}

interface Props {
  asset: MediaAsset;
  src?: string;
  className?: string;
  alt?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'sync' | 'auto';
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  draggable?: boolean;
  controls?: boolean;
  muted?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  onLoad?(event: SyntheticEvent<MediaElement>): void;
  onError?(): void;
}

/**
 * Images keep native lazy loading. Videos attach their source only near the
 * viewport so a masonry page does not open every media file on first render.
 */
export function AssetMedia({
  asset,
  src = asset.mediaUrl,
  className,
  alt = '',
  loading = 'eager',
  decoding = 'async',
  crossOrigin,
  draggable = false,
  controls = false,
  muted = false,
  preload = 'metadata',
  onLoad,
  onError,
}: Props) {
  const video = isVideoAsset(asset);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(loading !== 'lazy');

  useEffect(() => {
    if (!video || loading !== 'lazy') {
      setShouldLoadVideo(true);
      return undefined;
    }
    const element = videoRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldLoadVideo(true);
      return undefined;
    }
    setShouldLoadVideo(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoadVideo(true);
        observer.disconnect();
      },
      { rootMargin: '320px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, src, video]);

  if (!video) {
    return (
      <img
        className={className}
        src={src}
        alt={alt}
        loading={loading}
        decoding={decoding}
        crossOrigin={crossOrigin}
        draggable={draggable}
        onLoad={onLoad}
        onError={onError}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      className={className}
      src={shouldLoadVideo ? src : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt || controls ? undefined : true}
      crossOrigin={crossOrigin}
      draggable={draggable}
      controls={controls}
      muted={muted}
      playsInline
      preload={shouldLoadVideo ? preload : 'none'}
      onLoadedMetadata={(event) => {
        const element = event.currentTarget;
        if (!controls && Number.isFinite(element.duration) && element.duration > 0 && element.currentTime === 0) {
          element.currentTime = Math.min(0.05, element.duration / 2);
        }
      }}
      onLoadedData={onLoad}
      onError={onError}
    />
  );
}
