import type { AssetDto } from '@/shared/contracts';

/** Static representations only; original media URLs belong to playback/inspection surfaces. */
export function mediaThumbnailUrl(asset: Pick<AssetDto, 'id'>, size: number) {
  return thumbnailUrl('asset-thumbnail', asset.id, size);
}

export function codexGeneratedThumbnailUrl(image: { id: string; modifiedAt: string }, size: number) {
  return `${thumbnailUrl('codex-generated-thumbnail', image.id, size)}&revision=${encodeURIComponent(image.modifiedAt)}`;
}

function thumbnailUrl(host: 'asset-thumbnail' | 'codex-generated-thumbnail', id: string, size: number) {
  // Separate these requests from legacy URLs that may have cached an animated
  // original for a year after a thumbnail generation failure.
  return `aiy-media://${host}/${encodeURIComponent(id)}?size=${size}&representation=still`;
}
