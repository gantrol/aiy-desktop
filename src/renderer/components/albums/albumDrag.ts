import type { DragEvent as ReactDragEvent } from 'react';
import type { AssetFileDragIntent, MaterialSelectionTargetInput } from '@/shared/contracts';
import { writeReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import { itemDragIntent } from '@/renderer/components/albums/itemDrag';

export const ALBUM_DRAG_TYPE = 'application/x-aiy-album';
export const CREATION_ITEM_DRAG_TYPE = 'application/x-aiy-creation-item';
export const MATERIAL_ALBUM_DRAG_TYPE = 'application/x-aiy-material-album';
export const MATERIALS_DRAG_TYPE = 'application/x-aiy-materials';
const materialOriginType = 'application/x-aiy-material-origin';
let materialOrigin: string | undefined;

export type CreationTreeDrag = { kind: 'ALBUM' | 'CREATION_ITEM'; id: string };
let activeCreationTreeDrag: (CreationTreeDrag & { finish(): void }) | null = null;

export function endCreationTreeDrag() {
  activeCreationTreeDrag?.finish();
}

function beginCreationTreeDrag(target: CreationTreeDrag) {
  endCreationTreeDrag();
  const finish = () => {
    window.removeEventListener('dragend', finish, true);
    if (activeCreationTreeDrag?.finish === finish) activeCreationTreeDrag = null;
  };
  activeCreationTreeDrag = { ...target, finish };
  window.addEventListener('dragend', finish, { capture: true, once: true });
}

/** DataTransfer hides payloads during dragover; keep this renderer's identity
 * available so destinations can reject cycles before a drop occurs. */
export function readCreationTreeDrag(dataTransfer: DataTransfer): CreationTreeDrag | null {
  const session = activeCreationTreeDrag;
  if (!session) return null;
  const type = session.kind === 'ALBUM' ? ALBUM_DRAG_TYPE : CREATION_ITEM_DRAG_TYPE;
  if (!dataTransfer.types.includes(type)) return null;
  const transferredId = dataTransfer.getData(type).trim();
  return transferredId && transferredId !== session.id ? null : { kind: session.kind, id: session.id };
}

interface MaterialAlbumDragSession {
  id: number;
  albumId: string;
  finish(): void;
}

interface NativeMaterialsDragSession {
  requestId: string;
  intent: AssetFileDragIntent;
  targets: MaterialSelectionTargetInput[];
  sourceAlbumId?: string;
  finish(): void;
}

let activeNativeMaterialsDrag: NativeMaterialsDragSession | null = null;
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
export function beginNativeMaterialsDrag(targets: readonly MaterialSelectionTargetInput[], sourceAlbumId?: string) {
  activeNativeMaterialsDrag?.finish();
  const requestId = window.crypto.randomUUID();
  const intent: AssetFileDragIntent = 'EXPORT_FILES';
  const finish = () => {
    window.removeEventListener('dragend', finish, true);
    if (activeNativeMaterialsDrag?.requestId === requestId) activeNativeMaterialsDrag = null;
  };
  activeNativeMaterialsDrag = { requestId, intent, targets: uniqueMaterialTargets(targets), sourceAlbumId, finish };
  window.addEventListener('dragend', finish, { capture: true, once: true });
  return { requestId, intent, finish };
}

export function finishNativeMaterialsDrag(requestId: string) {
  if (activeNativeMaterialsDrag?.requestId === requestId) activeNativeMaterialsDrag.finish();
}

export function startNativeAssetFilesDrag(
  event: ReactDragEvent<HTMLElement>,
  assetIds: readonly string[],
  targets: readonly MaterialSelectionTargetInput[],
  sourceAlbumId?: string,
) {
  const uniqueAssetIds = [...new Set(assetIds.filter(Boolean))];
  if (!uniqueAssetIds.length) return null;
  event.preventDefault();
  event.stopPropagation();
  const session = beginNativeMaterialsDrag(targets, sourceAlbumId);
  try {
    window.desktopApi.assetFilesStartDrag({
      requestId: session.requestId,
      intent: session.intent,
      assetIds: uniqueAssetIds,
    });
    return true;
  } catch (reason) {
    session.finish();
    throw reason;
  }
}

export function startNativeImageAssetDrag(event: ReactDragEvent<HTMLElement>, assetIds: readonly string[]) {
  const uniqueAssetIds = [...new Set(assetIds.filter(Boolean))];
  return startNativeAssetFilesDrag(
    event,
    uniqueAssetIds,
    uniqueAssetIds.map((imageAssetId) => ({ kind: 'IMAGE_ASSET', imageAssetId })),
  );
}

export function startImageAssetDrag(event: ReactDragEvent<HTMLElement>, assetIds: readonly string[]) {
  const uniqueAssetIds = [...new Set(assetIds.filter(Boolean))];
  if (!uniqueAssetIds.length) return null;
  if (event.shiftKey) {
    event.stopPropagation();
    writeMaterialsDrag(
      event.dataTransfer,
      uniqueAssetIds.map((imageAssetId) => ({ kind: 'IMAGE_ASSET', imageAssetId })),
    );
    return null;
  }
  return startNativeImageAssetDrag(event, uniqueAssetIds);
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

export function beginMaterialAlbumDrag(dataTransfer: DataTransfer, albumId: string) {
  activeMaterialAlbumDrag?.finish();
  const id = ++nextMaterialAlbumDragId;
  dataTransfer.effectAllowed = 'copyMove';
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
  dataTransfer.effectAllowed = 'all';
  writeReferenceDrag(dataTransfer, [{ source: { kind: 'ALBUM', id: albumId } }]);
  dataTransfer.setData(ALBUM_DRAG_TYPE, albumId);
  dataTransfer.setData('text/plain', albumId);
  beginCreationTreeDrag({ kind: 'ALBUM', id: albumId });
}

export function writeCreationItemDrag(dataTransfer: DataTransfer, creationItemId: string) {
  const id = creationItemId.trim();
  if (!id) throw new Error('A creation-item drag requires an ID');
  dataTransfer.effectAllowed = 'all';
  writeReferenceDrag(dataTransfer, [{ source: { kind: 'CREATION_ITEM', id } }]);
  dataTransfer.setData(CREATION_ITEM_DRAG_TYPE, id);
  dataTransfer.setData('text/plain', id);
  beginCreationTreeDrag({ kind: 'CREATION_ITEM', id });
}

export function readCreationItemDrag(dataTransfer: DataTransfer): string | null {
  return dataTransfer.getData(CREATION_ITEM_DRAG_TYPE).trim() || null;
}

export function writeMaterialsDrag(
  dataTransfer: DataTransfer,
  targets: readonly MaterialSelectionTargetInput[],
  sourceAlbumId?: string,
) {
  dataTransfer.effectAllowed = 'copyMove';
  dataTransfer.setData(MATERIALS_DRAG_TYPE, JSON.stringify(targets));
  materialOrigin = sourceAlbumId;
  if (sourceAlbumId) dataTransfer.setData(materialOriginType, sourceAlbumId);
  window.addEventListener(
    'dragend',
    () => {
      materialOrigin = undefined;
    },
    { once: true },
  );
  dataTransfer.setData('text/plain', `${targets.length}`);
}

export function materialDropSource(event: ReactDragEvent): string | undefined {
  if (itemDragIntent(event) !== 'MOVE') return undefined;
  if (event.dataTransfer.types.includes(MATERIALS_DRAG_TYPE))
    return event.dataTransfer.getData(materialOriginType) || materialOrigin;
  return activeNativeMaterialsDrag?.sourceAlbumId;
}

export function materialDropEffect(event: ReactDragEvent): 'move' | 'copy' | 'none' {
  const intent = itemDragIntent(event);
  if (intent !== 'MOVE' && intent !== 'COPY') return 'none';
  return materialDropSource(event) ? 'move' : 'copy';
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

export function readSingleImageAssetDrag(dataTransfer: DataTransfer) {
  const targets = readMaterialsDrag(dataTransfer);
  if (targets.length !== 1) return null;
  const target = targets[0];
  return target?.kind === 'IMAGE_ASSET' ? target.imageAssetId : null;
}
