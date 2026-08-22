import type { DragEvent as ReactDragEvent } from 'react';
import type { MaterialSelectionTargetInput } from '@/shared/contracts';

export const ALBUM_DRAG_TYPE = 'application/x-aiy-album';
export const CREATION_DRAG_TYPE = 'application/x-aiy-creation';
export const CREATION_COLLECTION_DRAG_TYPE = 'application/x-aiy-creation-collection';
export const MATERIAL_ALBUM_DRAG_TYPE = 'application/x-aiy-material-album';
export const MATERIALS_DRAG_TYPE = 'application/x-aiy-materials';

interface CreationCollectionDragSession {
  id: number;
  albumId: string;
  finish(): void;
}

interface MaterialAlbumDragSession {
  id: number;
  albumId: string;
  finish(): void;
}

interface NativeMaterialsDragSession {
  id: number;
  targets: MaterialSelectionTargetInput[];
}

let nextNativeMaterialsDragId = 0;
let activeNativeMaterialsDrag: NativeMaterialsDragSession | null = null;
let nextCreationCollectionDragId = 0;
let activeCreationCollectionDrag: CreationCollectionDragSession | null = null;
let nextMaterialAlbumDragId = 0;
let activeMaterialAlbumDrag: MaterialAlbumDragSession | null = null;

function uniqueMaterialTargets(targets: readonly MaterialSelectionTargetInput[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.kind === 'MATERIAL' ? `material:${target.materialId}` : `asset:${target.imageAssetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Native file drags discard the custom DataTransfer payload. Keep the trusted
 * material identities alongside the OS drag so a drop back inside this
 * renderer can file existing materials instead of importing their files.
 */
export function beginNativeMaterialsDrag(targets: readonly MaterialSelectionTargetInput[]) {
  const id = ++nextNativeMaterialsDragId;
  activeNativeMaterialsDrag = { id, targets: uniqueMaterialTargets(targets) };
  const finish = () => {
    window.removeEventListener('dragend', finish, true);
    if (activeNativeMaterialsDrag?.id === id) activeNativeMaterialsDrag = null;
  };
  window.addEventListener('dragend', finish, { capture: true, once: true });
  return finish;
}

export function startImageAssetDrag(event: ReactDragEvent<HTMLElement>, assetIds: readonly string[]) {
  const uniqueAssetIds = [...new Set(assetIds.filter(Boolean))];
  if (!uniqueAssetIds.length) return null;
  const targets = uniqueAssetIds.map((imageAssetId) => ({
    kind: 'IMAGE_ASSET' as const,
    imageAssetId,
  }));
  if (event.shiftKey) {
    event.stopPropagation();
    writeMaterialsDrag(event.dataTransfer, targets);
    return null;
  }
  event.preventDefault();
  event.stopPropagation();
  const finishNativeDrag = beginNativeMaterialsDrag(targets);
  return window.desktopApi.assetFilesStartDrag(uniqueAssetIds).finally(finishNativeDrag);
}

export function hasMaterialsDrag(dataTransfer: DataTransfer) {
  return (
    dataTransfer.types.includes(MATERIALS_DRAG_TYPE) ||
    (dataTransfer.types.includes('Files') && Boolean(activeNativeMaterialsDrag?.targets.length))
  );
}

/**
 * A Files payload is external intake only when it was not created by the
 * renderer's current material export drag. These categories are deliberately
 * mutually exclusive so dragging an existing material back over AIY can never
 * send its own backing file through intake.
 */
export function hasExternalFilesDrag(dataTransfer: DataTransfer) {
  return dataTransfer.types.includes('Files') && !hasMaterialsDrag(dataTransfer);
}

export function beginCreationCollectionDrag(dataTransfer: DataTransfer, albumId: string) {
  activeCreationCollectionDrag?.finish();
  const id = ++nextCreationCollectionDragId;
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(CREATION_COLLECTION_DRAG_TYPE, albumId);
  dataTransfer.setData('text/plain', albumId);
  const finish = () => {
    window.removeEventListener('dragend', finish, true);
    if (activeCreationCollectionDrag?.id === id) activeCreationCollectionDrag = null;
  };
  activeCreationCollectionDrag = { id, albumId, finish };
  window.addEventListener('dragend', finish, { capture: true, once: true });
  return finish;
}

export function endCreationCollectionDrag() {
  activeCreationCollectionDrag?.finish();
}

export function hasCreationCollectionDrag(dataTransfer: DataTransfer) {
  return dataTransfer.types.includes(CREATION_COLLECTION_DRAG_TYPE) && Boolean(activeCreationCollectionDrag);
}

export function readCreationCollectionDrag(dataTransfer: DataTransfer) {
  const session = activeCreationCollectionDrag;
  if (!session || !dataTransfer.types.includes(CREATION_COLLECTION_DRAG_TYPE)) return null;
  const transferredAlbumId = dataTransfer.getData(CREATION_COLLECTION_DRAG_TYPE).trim();
  return transferredAlbumId && transferredAlbumId !== session.albumId ? null : session.albumId;
}

export function beginMaterialAlbumDrag(dataTransfer: DataTransfer, albumId: string) {
  activeMaterialAlbumDrag?.finish();
  const id = ++nextMaterialAlbumDragId;
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(MATERIAL_ALBUM_DRAG_TYPE, albumId);
  dataTransfer.setData('text/plain', albumId);
  const finish = () => {
    window.removeEventListener('dragend', finish, true);
    if (activeMaterialAlbumDrag?.id === id) activeMaterialAlbumDrag = null;
  };
  activeMaterialAlbumDrag = { id, albumId, finish };
  window.addEventListener('dragend', finish, { capture: true, once: true });
  return finish;
}

export function endMaterialAlbumDrag() {
  activeMaterialAlbumDrag?.finish();
}

export function hasMaterialAlbumDrag(dataTransfer: DataTransfer) {
  return dataTransfer.types.includes(MATERIAL_ALBUM_DRAG_TYPE) && Boolean(activeMaterialAlbumDrag);
}

export function readMaterialAlbumDrag(dataTransfer: DataTransfer) {
  const session = activeMaterialAlbumDrag;
  if (!session || !dataTransfer.types.includes(MATERIAL_ALBUM_DRAG_TYPE)) return null;
  const transferredAlbumId = dataTransfer.getData(MATERIAL_ALBUM_DRAG_TYPE).trim();
  return transferredAlbumId && transferredAlbumId !== session.albumId ? null : session.albumId;
}

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
  if (!value) {
    return dataTransfer.types.includes('Files') ? [...(activeNativeMaterialsDrag?.targets ?? [])] : [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return uniqueMaterialTargets(
      parsed.flatMap((item): MaterialSelectionTargetInput[] => {
        if (!item || typeof item !== 'object') return [];
        const candidate = item as Record<string, unknown>;
        if (candidate.kind === 'MATERIAL' && typeof candidate.materialId === 'string') {
          return [{ kind: 'MATERIAL', materialId: candidate.materialId }];
        }
        if (candidate.kind === 'IMAGE_ASSET' && typeof candidate.imageAssetId === 'string') {
          return [{ kind: 'IMAGE_ASSET', imageAssetId: candidate.imageAssetId }];
        }
        return [];
      }),
    );
  } catch {
    return [];
  }
}
