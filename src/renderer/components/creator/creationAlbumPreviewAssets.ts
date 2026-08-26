import type { AlbumDto, AssetDto } from '@/shared/contracts';
import type { CreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';

export function creationAlbumPreviewAssets(album: AlbumDto, filter: CreationLibraryFilter): AssetDto[] {
  const includeCreativeMedia = filter.images || filter.inspirations || filter.socialPosts || filter.articles;
  const assets = [
    ...(includeCreativeMedia ? album.previewAssets : []),
    ...(filter.documents ? (album.documentPreviewAssets ?? []) : []),
  ];
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.mimeType.startsWith('image/') || seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}
