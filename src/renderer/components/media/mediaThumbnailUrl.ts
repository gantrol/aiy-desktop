import type { AssetDto } from '@/shared/contracts';

export function mediaThumbnailUrl(asset: AssetDto, size: number) {
  return `aiy-media://asset-thumbnail/${encodeURIComponent(asset.id)}?size=${size}`;
}
