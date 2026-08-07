import { ImagesIcon } from 'lucide-react';
import type { MaterialAlbumDto } from '@/shared/contracts';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';

export function MaterialAlbumHeader({
  album,
  countLabel,
  pathLabel,
}: {
  album: MaterialAlbumDto;
  countLabel: string;
  pathLabel?: string;
}) {
  const preview = album.previewAssets[0];
  return (
    <div
      data-slot="material-album-header"
      data-album-id={album.id}
      data-material-count={album.materialCount}
      className="flex min-h-20 shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6"
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border bg-media-surround-light text-selected-foreground">
        {preview ? (
          <AssetMedia asset={preview} alt="" draggable={false} className="size-full object-contain" muted />
        ) : (
          <ImagesIcon className="size-5" />
        )}
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-xl font-semibold tracking-tight">{album.title}</h2>
        {pathLabel && <p className="mt-0.5 truncate text-xs text-muted-foreground">{pathLabel}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{countLabel}</p>
      </div>
    </div>
  );
}
