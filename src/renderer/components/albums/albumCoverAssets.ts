/** A cover is a bounded preview, not a second collection or its member count. */
export interface AlbumCoverAsset {
  id: string;
  width?: number | null;
  height?: number | null;
}

export const ALBUM_COVER_LAYERS = 3;
export const ALBUM_PREVIEW_LIMIT = 5;

/** Preserve source order; repeated thumbnails do not imply extra photographs. */
export function albumCoverAssets<T extends AlbumCoverAsset>(assets: readonly T[], limit = ALBUM_PREVIEW_LIMIT): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  const count = Math.min(ALBUM_PREVIEW_LIMIT, Math.max(0, Math.floor(limit)));
  if (!Number.isFinite(count) || count === 0) return result;
  for (const asset of assets) {
    if (!asset.id || seen.has(asset.id)) continue;
    seen.add(asset.id);
    result.push(asset);
    if (result.length === count) break;
  }
  return result;
}
