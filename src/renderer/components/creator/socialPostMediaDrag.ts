import type { DragEvent } from 'react';
import { readSingleImageAssetDrag, startNativeImageAssetDrag } from '@/renderer/components/albums/albumDrag';

export function startSocialPostMediaDrag(event: DragEvent<HTMLElement>, assetId: string) {
  return startNativeImageAssetDrag(event, [assetId]);
}

export function socialPostMediaReorderSourceId(dataTransfer: DataTransfer, mediaAssetIds: readonly string[]) {
  const sourceId = readSingleImageAssetDrag(dataTransfer);
  return sourceId && mediaAssetIds.includes(sourceId) ? sourceId : null;
}

export function hasSocialPostMediaReorderDrag(dataTransfer: DataTransfer, mediaAssetIds: readonly string[]) {
  return Boolean(socialPostMediaReorderSourceId(dataTransfer, mediaAssetIds));
}
