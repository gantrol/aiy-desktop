import { FolderIcon, SquarePenIcon } from 'lucide-react';
import type { MaterialAlbumDto } from '@/shared/contracts';
import { AlbumCoverStack } from '@/renderer/components/albums/AlbumCoverStack';
import { AlbumPreviewPopover } from '@/renderer/components/albums/AlbumPreviewPopover';
import {
  startCollectionCardDrag,
  endCollectionCardDrag,
} from '@/renderer/components/gallery/collectionAlbumDragHandlers';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

export function CollectionAlbumTile({
  album,
  openLabel,
  detailLabel,
  dragKind,
  onOpen,
}: {
  album: MaterialAlbumDto;
  openLabel: string;
  detailLabel: string;
  dragKind: 'MATERIAL' | 'CREATION' | null;
  onOpen(albumId: string): void;
}) {
  return (
    <div className="flex size-full min-w-0 flex-col">
      <Button
        variant="ghost"
        data-action={album.kind === 'USER' ? 'material-open-album' : 'material-open-creation-collection'}
        className="min-h-0 w-full min-w-0 flex-1 items-stretch justify-start rounded-md p-0 hover:bg-transparent"
        aria-label={`${openLabel}: ${album.title}`}
        onClick={() => onOpen(album.id)}
      >
        <AlbumCoverStack
          assets={album.previewAssets}
          title={album.title}
          icon={album.systemKey === 'CREATION_SERIES' ? SquarePenIcon : FolderIcon}
        />
      </Button>
      <div className="flex h-13 min-w-0 shrink-0 items-center gap-1 pl-1 pr-8">
        <button
          type="button"
          data-material-album-drag-handle={dragKind === 'MATERIAL' ? album.id : undefined}
          data-creation-collection-drag-handle={dragKind === 'CREATION' ? album.id : undefined}
          draggable={dragKind !== null}
          className={cn(
            'min-w-0 flex-1 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
            dragKind && 'cursor-grab active:cursor-grabbing',
          )}
          onClick={() => onOpen(album.id)}
          onDragStart={(event) => startCollectionCardDrag(event, dragKind, album.id)}
          onDragEnd={endCollectionCardDrag}
          aria-label={`${openLabel}: ${album.title}`}
          title={album.title}
        >
          <span className="block truncate text-sm font-medium">{album.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={detailLabel}>
            {detailLabel}
          </span>
        </button>
        <AlbumPreviewPopover
          key={album.id}
          assets={album.previewAssets}
          title={album.title}
          detail={detailLabel}
          openLabel={openLabel}
          onOpen={() => onOpen(album.id)}
        />
      </div>
    </div>
  );
}
