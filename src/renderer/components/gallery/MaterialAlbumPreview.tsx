import { ImagesIcon, VideoIcon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { AssetMedia, isVideoAsset } from '@/renderer/components/media/AssetMedia';

interface Props {
  asset?: AssetDto;
  className?: string;
  iconClassName?: string;
  previewVideo?: boolean;
}

export function MaterialAlbumPreview({ asset, className, iconClassName, previewVideo = false }: Props) {
  const video = isVideoAsset(asset);
  return (
    <span
      className={cn(
        'relative isolate grid shrink-0 place-items-center overflow-hidden bg-surface-sunken text-muted-foreground',
        video && previewVideo && 'bg-media-surround-dark',
        className,
      )}
    >
      {video && !previewVideo ? (
        <VideoIcon className={cn('size-3.5', iconClassName)} />
      ) : asset ? (
        video ? (
          <AssetMedia
            asset={asset}
            alt=""
            draggable={false}
            loading="lazy"
            className="relative z-10 size-full object-contain"
            muted
          />
        ) : (
          <AssetThumbnail asset={asset} size={96} ambient className="size-full object-contain" />
        )
      ) : (
        <ImagesIcon className={cn('size-3.5', iconClassName)} />
      )}
    </span>
  );
}
