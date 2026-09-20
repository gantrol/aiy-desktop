import { FolderIcon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';

interface Props {
  asset?: AssetDto;
  className?: string;
  iconClassName?: string;
}

/** Small destination rows keep one still cover, leaving room for the album name. */
export function MaterialAlbumPreview({ asset, className, iconClassName }: Props) {
  return (
    <span
      className={cn(
        'relative isolate grid shrink-0 place-items-center overflow-hidden bg-surface-sunken text-muted-foreground',
        className,
      )}
    >
      {asset ? (
        <AssetThumbnail
          asset={asset}
          size={96}
          alt=""
          className="size-full object-contain"
          errorClassName="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2"
        />
      ) : (
        <FolderIcon className={cn('size-3.5', iconClassName)} />
      )}
    </span>
  );
}
