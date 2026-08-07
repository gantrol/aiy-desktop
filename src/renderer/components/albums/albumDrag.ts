import type { MaterialSelectionTargetInput } from '@/shared/contracts';

export const ALBUM_DRAG_TYPE = 'application/x-aiy-album';
export const CREATION_DRAG_TYPE = 'application/x-aiy-creation';
export const MATERIALS_DRAG_TYPE = 'application/x-aiy-materials';

export function writeAlbumDrag(dataTransfer: DataTransfer, albumId: string) {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(ALBUM_DRAG_TYPE, albumId);
  dataTransfer.setData('text/plain', albumId);
}

export function writeCreationDrag(dataTransfer: DataTransfer, seriesIds: string | readonly string[]) {
  const ids = [...new Set((typeof seriesIds === 'string' ? [seriesIds] : seriesIds).filter(Boolean))];
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(CREATION_DRAG_TYPE, JSON.stringify(ids));
  dataTransfer.setData('text/plain', ids[0] ?? '');
}

export function readCreationDrag(dataTransfer: DataTransfer): string[] {
  const value = dataTransfer.getData(CREATION_DRAG_TYPE);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && Boolean(item)))];
  } catch {
    return [];
  }
}

export function writeMaterialsDrag(dataTransfer: DataTransfer, targets: readonly MaterialSelectionTargetInput[]) {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(MATERIALS_DRAG_TYPE, JSON.stringify(targets));
  dataTransfer.setData('text/plain', `${targets.length}`);
}

export function readMaterialsDrag(dataTransfer: DataTransfer): MaterialSelectionTargetInput[] {
  const value = dataTransfer.getData(MATERIALS_DRAG_TYPE);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): MaterialSelectionTargetInput[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Record<string, unknown>;
      if (candidate.kind === 'MATERIAL' && typeof candidate.materialId === 'string') {
        return [{ kind: 'MATERIAL', materialId: candidate.materialId }];
      }
      if (candidate.kind === 'IMAGE_ASSET' && typeof candidate.imageAssetId === 'string') {
        return [{ kind: 'IMAGE_ASSET', imageAssetId: candidate.imageAssetId }];
      }
      return [];
    });
  } catch {
    return [];
  }
}
