import { useState, type ComponentPropsWithoutRef } from 'react';
import { ImageOffIcon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';

type Props = Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'srcSet'> & {
  asset: Pick<AssetDto, 'id'>;
  size: number;
  /** The owning frame supplies relative positioning, isolation and clipping. */
  ambient?: boolean;
  /** Optional bounded failure glyph; the owning frame keeps its measured size. */
  errorClassName?: string;
};

function AssetThumbnailFrame({
  src,
  ambient = false,
  alt = '',
  loading = 'lazy',
  decoding = 'async',
  draggable = false,
  className,
  errorClassName,
  crossOrigin,
  onError,
  ...imageProps
}: Omit<Props, 'asset' | 'size'> & { src: string }) {
  const [failed, setFailed] = useState(false);
  const { messages } = useI18n();
  if (failed) {
    return (
      <ImageOffIcon
        role="img"
        aria-label={alt || messages.contentEditor.imageUnavailable}
        className={cn('text-muted-foreground', ambient && 'relative z-10', errorClassName ?? className)}
        style={imageProps.style}
      />
    );
  }
  return (
    <>
      {ambient && <ImageAmbientBackdrop src={src} loading={loading} decoding={decoding} crossOrigin={crossOrigin} />}
      <img
        {...imageProps}
        src={src}
        alt={alt}
        loading={loading}
        decoding={decoding}
        draggable={draggable}
        crossOrigin={crossOrigin}
        className={cn(ambient && 'relative z-10', className)}
        onError={(event) => {
          setFailed(true);
          onError?.(event);
        }}
      />
    </>
  );
}

/** Navigation and selection use still thumbnails, independent of the source format. */
export function AssetThumbnail({ asset, size, ...props }: Props) {
  const src = mediaThumbnailUrl(asset, size);
  // Reset failures only when the requested media changes, not on parent renders.
  return <AssetThumbnailFrame key={src} src={src} {...props} />;
}
