import type { GalleryItemDto } from '@/shared/contracts';

export interface AssetCreationDestination {
  kind: 'CREATION';
  id: string;
  title: string;
  versionId: string | null;
  versionNo: number | null;
  available: boolean;
}

export interface AssetTermDestination {
  kind: 'TERM';
  id: string;
  title: string;
  available: boolean;
}

export type AssetSourceDestination = AssetCreationDestination | AssetTermDestination;
export type AssetSourceIdentity =
  Pick<AssetCreationDestination, 'kind' | 'id' | 'versionId'> | Pick<AssetTermDestination, 'kind' | 'id'>;

export interface AssetNavigationDto {
  material: GalleryItemDto;
  sources: AssetSourceDestination[];
}

export type AssetNavigationTarget =
  | { kind: 'MATERIAL'; assetId: string }
  | { kind: 'CREATION'; assetId: string; seriesId: string; versionId?: string }
  | { kind: 'TERM'; termId: string };

export function assetSourceKey(source: AssetSourceIdentity) {
  return source.kind === 'CREATION' ? `${source.kind}:${source.id}:${source.versionId ?? ''}` : `TERM:${source.id}`;
}
