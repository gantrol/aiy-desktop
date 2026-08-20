import { ChevronRightIcon } from 'lucide-react';
import type { MaterialAlbumDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { MaterialAlbumPreview } from '@/renderer/components/gallery/MaterialAlbumPreview';
import { Button } from '@/renderer/components/ui/button';

export function MaterialAlbumHeader({
  album,
  countLabel,
  pathLabel,
  ancestors = [],
  onOpenRoot,
  onOpenAlbum,
}: {
  album: MaterialAlbumDto;
  countLabel: string;
  pathLabel?: string;
  ancestors?: readonly MaterialAlbumDto[];
  onOpenRoot?(): void;
  onOpenAlbum?(albumId: string): void;
}) {
  const { messages } = useI18n();
  const preview = album.previewAssets[0];
  return (
    <div
      data-slot="material-album-header"
      data-album-id={album.id}
      data-material-count={album.materialCount}
      className="flex min-h-20 shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6"
    >
      <MaterialAlbumPreview
        asset={preview}
        previewVideo
        className="size-11 rounded-xl border text-selected-foreground"
        iconClassName="size-5"
      />
      <div className="min-w-0">
        {onOpenRoot && (
          <nav aria-label={messages.gallery.albums.path} className="mb-0.5 flex min-w-0 items-center text-xs">
            <Button
              type="button"
              variant="link"
              size="2xs"
              className="h-auto min-w-0 px-0 py-0 text-xs font-normal text-muted-foreground"
              onClick={onOpenRoot}
            >
              <span className="truncate">{messages.gallery.albums.allMaterials}</span>
            </Button>
            {ancestors.map((ancestor) => (
              <span key={ancestor.id} className="flex min-w-0 items-center">
                <ChevronRightIcon className="mx-1 size-3 shrink-0 text-muted-foreground" />
                <Button
                  type="button"
                  variant="link"
                  size="2xs"
                  className="h-auto min-w-0 px-0 py-0 text-xs font-normal text-muted-foreground"
                  onClick={() => onOpenAlbum?.(ancestor.id)}
                >
                  <span className="truncate">{ancestor.title}</span>
                </Button>
              </span>
            ))}
          </nav>
        )}
        <h2 className="truncate text-xl font-semibold tracking-tight">{album.title}</h2>
        {pathLabel && <p className="mt-0.5 truncate text-xs text-muted-foreground">{pathLabel}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{countLabel}</p>
      </div>
    </div>
  );
}
