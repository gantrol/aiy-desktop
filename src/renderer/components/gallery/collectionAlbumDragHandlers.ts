import type { DragEvent } from 'react';
import {
  beginCreationCollectionDrag,
  beginMaterialAlbumDrag,
  endCreationCollectionDrag,
  endMaterialAlbumDrag,
} from '@/renderer/components/albums/albumDrag';

export function startCollectionCardDrag(
  event: DragEvent<HTMLElement>,
  kind: 'MATERIAL' | 'CREATION' | null,
  albumId: string,
) {
  if (!kind) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  if (kind === 'MATERIAL') beginMaterialAlbumDrag(event.dataTransfer, albumId);
  else beginCreationCollectionDrag(event.dataTransfer, albumId);
}

export function endCollectionCardDrag(event: DragEvent<HTMLElement>) {
  event.stopPropagation();
  endMaterialAlbumDrag();
  endCreationCollectionDrag();
}
