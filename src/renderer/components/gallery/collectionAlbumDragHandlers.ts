import type { DragEvent } from 'react';
import type { MaterialAlbumDto } from '@/shared/contracts';
import {
  writeAlbumDrag,
  writeCreationItemDrag,
  beginMaterialAlbumDrag,
  endCreationTreeDrag,
  endMaterialAlbumDrag,
} from '@/renderer/components/albums/albumDrag';

export function startCollectionCardDrag(
  event: DragEvent<HTMLElement>,
  kind: 'MATERIAL' | 'CREATION' | null,
  album: MaterialAlbumDto,
) {
  if (!kind) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  if (kind === 'MATERIAL') beginMaterialAlbumDrag(event.dataTransfer, album.id);
  else if (album.sourceCreationItemId) writeCreationItemDrag(event.dataTransfer, album.sourceCreationItemId);
  else if (album.sourceAlbumId) writeAlbumDrag(event.dataTransfer, album.sourceAlbumId);
  else event.preventDefault();
}

export function endCollectionCardDrag(event: DragEvent<HTMLElement>) {
  event.stopPropagation();
  endMaterialAlbumDrag();
  endCreationTreeDrag();
}
