import type { LucideIcon } from 'lucide-react';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';

/** A cover or the actual content title, without a decorative empty image slot. */
export function CollectionPreview({
  asset,
  title,
  icon: Icon,
}: {
  asset?: { id: string } | null;
  title: string;
  icon: LucideIcon;
}) {
  return (
    <span className="relative isolate block min-h-0 w-full flex-1 overflow-hidden rounded-sm bg-surface-sunken">
      {asset ? (
        <>
          <AssetThumbnail asset={asset} size={512} alt="" className="absolute inset-0 size-full object-contain" />
          <span className="absolute bottom-1.5 left-1.5 grid size-5 place-items-center rounded-sm bg-overlay/90 text-foreground">
            <Icon className="size-3.5" />
          </span>
        </>
      ) : (
        <span className="absolute inset-0 flex flex-col items-start justify-between gap-3 p-4">
          <Icon className="size-5 text-muted-foreground" />
          <span className="line-clamp-4 w-full whitespace-normal break-words text-base font-medium leading-6">
            {title}
          </span>
        </span>
      )}
    </span>
  );
}
