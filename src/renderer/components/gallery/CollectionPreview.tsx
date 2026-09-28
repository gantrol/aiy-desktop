import type { ReactNode } from 'react';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';

/** Only actual images have a cover preview. Text items are rendered by the host. */
export function CollectionPreview({
  asset,
  title,
  caption,
}: {
  asset?: { id: string } | null;
  title: string;
  caption?: ReactNode;
}) {
  if (!asset) return null;
  return (
    <span
      title={title}
      className="relative isolate block min-h-0 w-full flex-1 overflow-hidden rounded-sm bg-surface-sunken"
    >
      <AssetThumbnail asset={asset} size={512} alt="" className="absolute inset-0 size-full object-contain" />
      {caption}
    </span>
  );
}
