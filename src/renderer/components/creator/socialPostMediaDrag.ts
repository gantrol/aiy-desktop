import type { DragEvent } from 'react';

const socialPostMediaDragType = 'application/x-aiy-social-post-media';

export function startSocialPostMediaDrag(event: DragEvent<HTMLElement>, assetId: string) {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(socialPostMediaDragType, assetId);
}

export function socialPostMediaReorderSourceId(dataTransfer: DataTransfer, mediaAssetIds: readonly string[]) {
  const internalSourceId = dataTransfer.getData(socialPostMediaDragType).trim();
  return internalSourceId && mediaAssetIds.includes(internalSourceId) ? internalSourceId : null;
}

export function hasSocialPostMediaReorderDrag(dataTransfer: DataTransfer) {
  return dataTransfer.types.includes(socialPostMediaDragType);
}
