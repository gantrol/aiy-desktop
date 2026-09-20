import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { imagePreviewSource, mayAnimateImage, mediaPosterUrl, type PreviewAsset } from '@/shared/media-preview-policy';
import { useMediaActivity, useMediaReducedMotion } from '@/renderer/components/media/useMediaActivity';

type MediaAsset = PreviewAsset & { id?: string };
type MediaElement = HTMLImageElement | HTMLVideoElement;

export function isVideoAsset(asset: Pick<AssetDto, 'mimeType'> | null | undefined) {
  return Boolean(asset?.mimeType.startsWith('video/'));
}

interface Props {
  asset: MediaAsset;
  src?: string;
  /** A representation choice, independent of content identity. Omit for an explicit original/inspection surface. */
  previewSize?: number;
  motion?: 'auto' | 'play' | 'still';
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

/** Original animations are used only while visible and within budget. Still thumbnail URLs keep their original contract. */
export function AssetMedia({
  asset,
  src,
  previewSize,
  motion = 'auto',
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
  const mediaRef = useRef<MediaElement | null>(null);
  const visible = useMediaActivity(mediaRef, src ?? asset.mediaUrl);
  const reducedMotion = useMediaReducedMotion();
  const [loadedVideoSource, setLoadedVideoSource] = useState<string | null>(null);
  const requested = src ?? (previewSize && asset.id ? mediaPosterUrl(asset.id, previewSize) : asset.mediaUrl);
  const preview = previewSize !== undefined;
  const imageSrc = preview ? imagePreviewSource(asset, requested, { visible, reducedMotion, motion }) : requested;
  const videoSource = src ?? asset.mediaUrl;
  // Once metadata exists, pause instead of removing src: removing it resets the playhead.
  // A different asset does not inherit that loaded state and still waits for visibility.
  const shouldLoadVideo = loading !== 'lazy' || visible || loadedVideoSource === videoSource;

  useEffect(() => {
    if (video && !visible) (mediaRef.current as HTMLVideoElement | null)?.pause();
  }, [video, visible]);

  if (!video)
    return (
      <img
        ref={(element) => {
          mediaRef.current = element;
        }}
        className={className}
        src={imageSrc}
        data-media-animated={preview && mayAnimateImage(asset) ? 'true' : undefined}
        alt={alt}
        loading={loading}
        decoding={decoding}
        crossOrigin={crossOrigin}
        draggable={draggable}
        onLoad={onLoad}
        onError={onError}
      />
    );

  return (
    <video
      ref={(element) => {
        mediaRef.current = element;
      }}
      className={className}
      src={shouldLoadVideo ? videoSource : undefined}
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
        setLoadedVideoSource(videoSource);
        if (!controls && Number.isFinite(element.duration) && element.duration > 0 && element.currentTime === 0) {
          element.currentTime = Math.min(0.05, element.duration / 2);
        }
      }}
      onLoadedData={onLoad}
      onError={onError}
    />
  );
}
