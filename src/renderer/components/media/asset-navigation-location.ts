import type { AppLocation } from '@/renderer/components/app/app-navigation';
import type { AssetNavigationTarget } from '@/shared/contracts/asset-navigation';

export function currentMaterialAssetId(location: AppLocation) {
  if (location.view !== 'gallery') return null;
  return (
    location.gallery.requestedAssetId ??
    location.gallery.selectedMaterialKey?.match(/^(?:image|video):(.+)$/)?.[1] ??
    null
  );
}

export function assetNavigationLocation(current: AppLocation, target: AssetNavigationTarget): AppLocation {
  const base = { ...current, materialsReturnContext: null };
  if (target.kind === 'MATERIAL')
    return {
      ...base,
      view: 'gallery',
      gallery: {
        collection: { kind: 'all' },
        selectedMaterialKey: null,
        requestedMaterialId: null,
        requestedAssetId: target.assetId,
      },
    };
  if (target.kind === 'TERM')
    return {
      ...base,
      view: 'dictionary',
      dictionary: { surface: 'detail', termId: target.termId, browseContext: null },
    };
  return {
    ...base,
    view: 'creator',
    creator: {
      surface: 'existing-creation',
      seriesId: target.seriesId,
      assetId: target.assetId,
      ...(target.versionId ? { versionId: target.versionId } : {}),
    },
  };
}
