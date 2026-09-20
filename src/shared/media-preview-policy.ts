/** Preview budgets are product defaults, not proof that a file is cheap to decode. */
export const MEDIA_PREVIEW_LIMITS = {
  svgBytes: 256 * 1024,
  svgPixels: 4 * 1024 * 1024,
  animatedBytes: 8 * 1024 * 1024,
  animatedPixels: 4 * 1024 * 1024,
} as const;

export interface PreviewAsset {
  mediaUrl: string;
  mimeType: string;
  byteSize?: number;
  width?: number;
  height?: number;
  animated?: boolean;
}

export function mayAnimateImage(asset: PreviewAsset): boolean {
  // PNG/WebP may contain animation even when import metadata has not inspected frame count.
  return (
    asset.animated === true ||
    (asset.animated !== false && ['image/gif', 'image/webp', 'image/png', 'image/apng'].includes(asset.mimeType))
  );
}

function withinBudget(asset: PreviewAsset, bytes: number, pixels: number): boolean {
  return (
    Number.isFinite(asset.byteSize) &&
    Number.isFinite(asset.width) &&
    Number.isFinite(asset.height) &&
    asset.byteSize! > 0 &&
    asset.byteSize! <= bytes &&
    asset.width! > 0 &&
    asset.height! > 0 &&
    asset.width! * asset.height! <= pixels
  );
}

export function needsSvgPoster(asset: PreviewAsset): boolean {
  return (
    asset.mimeType === 'image/svg+xml' &&
    !withinBudget(asset, MEDIA_PREVIEW_LIMITS.svgBytes, MEDIA_PREVIEW_LIMITS.svgPixels)
  );
}

export interface PreviewIntent {
  visible: boolean;
  reducedMotion: boolean;
  motion?: 'auto' | 'play' | 'still';
}

/** Every image that may auto-play must also have an explicit pause path. */
export function hasImagePlaybackControl(asset: PreviewAsset): boolean {
  if (asset.mimeType === 'image/svg+xml') return !needsSvgPoster(asset);
  return asset.mimeType.startsWith('image/') && mayAnimateImage(asset);
}

/** A poster failure must never silently load an expensive original. Opening the source is a separate action. */
export function imagePreviewSource(asset: PreviewAsset, poster: string, intent: PreviewIntent): string {
  if (asset.mimeType === 'image/svg+xml') {
    return needsSvgPoster(asset) ||
      !intent.visible ||
      intent.motion === 'still' ||
      (intent.reducedMotion && intent.motion !== 'play')
      ? poster
      : asset.mediaUrl;
  }
  if (!mayAnimateImage(asset)) return poster;
  if (!intent.visible || intent.motion === 'still') return poster;
  if (intent.motion === 'play') return asset.mediaUrl;
  if (intent.reducedMotion) return poster;
  return withinBudget(asset, MEDIA_PREVIEW_LIMITS.animatedBytes, MEDIA_PREVIEW_LIMITS.animatedPixels)
    ? asset.mediaUrl
    : poster;
}

export function mediaPosterUrl(assetId: string, size = 512): string {
  return `aiy-media://asset-thumbnail/${encodeURIComponent(assetId)}?size=${size}&representation=still`;
}
