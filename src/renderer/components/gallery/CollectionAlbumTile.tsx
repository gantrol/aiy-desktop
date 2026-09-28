import { FolderIcon, SquarePenIcon } from 'lucide-react';
import type { MaterialAlbumDto } from '@/shared/contracts';
import { AlbumCoverStack } from '@/renderer/components/albums/AlbumCoverStack';
import { AlbumPreviewPopover } from '@/renderer/components/albums/AlbumPreviewPopover';
import {
  startCollectionCardDrag,
  endCollectionCardDrag,
} from '@/renderer/components/gallery/collectionAlbumDragHandlers';
import { Button } from '@/renderer/components/ui/button';
import { itemDragStart, itemDragScopeProps } from '@/renderer/components/albums/itemDrag';
import { cn } from '@/renderer/lib/utils';
import { CollectionTextItem, collectionTextItemClassName } from '@/renderer/components/gallery/CollectionTextItem';
import { CollectionPreview } from '@/renderer/components/gallery/CollectionPreview';
import { MediaCardCaption } from '@/renderer/components/media/MediaCardCaption';

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
  const caption = (
    <MediaCardCaption>
      <strong className="block truncate text-sm font-semibold">{album.title}</strong>
      <span className="block truncate text-xs font-normal opacity-85" title={detailLabel}>
        {detailLabel}
      </span>
    </MediaCardCaption>
  );
  return (
    <div
      {...itemDragScopeProps}
      data-media-card
      className={cn('group relative flex w-full min-w-0 flex-col', album.previewAssets.length > 0 && 'h-full')}
      draggable={dragKind !== null}
      onDragStart={itemDragStart((event) => {
        startCollectionCardDrag(event, dragKind, album);
      })}
      onDragEnd={endCollectionCardDrag}
    >
      {album.previewAssets.length === 0 ? (
        <Button
          variant="ghost"
          data-action={album.kind === 'USER' ? 'material-open-album' : 'material-open-creation-collection'}
          className={collectionTextItemClassName()}
          aria-label={`${openLabel}: ${album.title}`}
          onClick={() => onOpen(album.id)}
        >
          <CollectionTextItem
            title={album.title}
            detail={detailLabel}
            updatedAt={album.updatedAt ?? undefined}
            icon={album.systemKey === 'CREATION_SERIES' ? SquarePenIcon : FolderIcon}
          />
        </Button>
      ) : (
        <>
          <Button
            variant="ghost"
            data-action={album.kind === 'USER' ? 'material-open-album' : 'material-open-creation-collection'}
            className={cn(
              'min-h-0 w-full min-w-0 flex-1 items-stretch justify-start rounded-sm p-0 hover:bg-transparent',
              dragKind && 'cursor-grab active:cursor-grabbing',
            )}
            aria-label={`${openLabel}: ${album.title}`}
            onClick={() => onOpen(album.id)}
          >
            {album.previewAssets.length === 1 ? (
              <CollectionPreview asset={album.previewAssets[0]} title={album.title} caption={caption} />
            ) : (
              <AlbumCoverStack
                assets={album.previewAssets}
                title={album.title}
                caption={caption}
                icon={album.systemKey === 'CREATION_SERIES' ? SquarePenIcon : FolderIcon}
              />
            )}
          </Button>
          <div data-item-drag-ignore className="absolute right-9 top-1 z-20">
            <AlbumPreviewPopover
              key={album.id}
              assets={album.previewAssets}
              title={album.title}
              detail={detailLabel}
              openLabel={openLabel}
              onOpen={() => onOpen(album.id)}
            />
          </div>
        </>
      )}
    </div>
  );
}
