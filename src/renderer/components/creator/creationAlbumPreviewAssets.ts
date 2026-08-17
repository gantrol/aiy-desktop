import type { AlbumDto, AssetDto } from '@/shared/contracts';
import type { CreationLibraryFilter } from '@/renderer/components/creator/CreationLibraryToolbar';

export function creationAlbumPreviewAssets(album: AlbumDto, filter: CreationLibraryFilter): AssetDto[] {
  const assets =
    filter === 'images'
      ? album.previewAssets
      : filter === 'documents'
        ? (album.documentPreviewAssets ?? [])
        : [...album.previewAssets, ...(album.documentPreviewAssets ?? [])];
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.mimeType.startsWith('image/') || seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}
