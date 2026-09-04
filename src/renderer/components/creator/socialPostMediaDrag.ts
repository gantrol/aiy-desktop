import type { DragEvent } from 'react';
import { readSingleImageAssetDrag, startNativeImageAssetDrag } from '@/renderer/components/albums/albumDrag';

const socialPostMediaDragType = 'application/x-aiy-social-post-media';

export function startSocialPostMediaReorderDrag(event: DragEvent<HTMLElement>, assetId: string) {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(socialPostMediaDragType, assetId);
}

export function startSocialPostMediaDrag(event: DragEvent<HTMLElement>, assetId: string) {
  return startNativeImageAssetDrag(event, [assetId]);
}

export function socialPostMediaReorderSourceId(dataTransfer: DataTransfer, mediaAssetIds: readonly string[]) {
  const sourceId = dataTransfer.getData(socialPostMediaDragType).trim() || readSingleImageAssetDrag(dataTransfer);
  return sourceId && mediaAssetIds.includes(sourceId) ? sourceId : null;
}

export function hasSocialPostMediaReorderDrag(dataTransfer: DataTransfer, mediaAssetIds: readonly string[]) {
  // Local HTML drag data is protected until drop; its type remains readable.
  return (
    dataTransfer.types.includes(socialPostMediaDragType) ||
    Boolean(socialPostMediaReorderSourceId(dataTransfer, mediaAssetIds))
  );
}

export function socialPostMediaDropEffect(dataTransfer: DataTransfer) {
  // Native file exports allow copy. Reordering only changes the post's IDs.
  return dataTransfer.types.includes(socialPostMediaDragType) ? 'move' : 'copy';
}
