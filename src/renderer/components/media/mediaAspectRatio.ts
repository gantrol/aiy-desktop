export const DEFAULT_MEDIA_ASPECT_RATIO = 4 / 3;
export const MIN_MEDIA_PREVIEW_ASPECT_RATIO = 1 / 2;
export const MAX_MEDIA_PREVIEW_ASPECT_RATIO = 2;

/** Keeps an image frame in sync with the source dimensions without cropping. */
export function getSourceMediaAspectRatio(width: number, height: number, fallback = DEFAULT_MEDIA_ASPECT_RATIO) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : fallback;
}

/** Keeps ordinary preview frames proportional while bounding extreme shapes for usable controls. */
export function getMediaPreviewAspectRatio(width: number, height: number, fallback = DEFAULT_MEDIA_ASPECT_RATIO) {
  const sourceAspectRatio = getSourceMediaAspectRatio(width, height, fallback);
  const aspectRatio = Math.max(
    MIN_MEDIA_PREVIEW_ASPECT_RATIO,
    Math.min(MAX_MEDIA_PREVIEW_ASPECT_RATIO, sourceAspectRatio),
  );
  return {
    aspectRatio,
    needsEdgeFill: Math.abs(sourceAspectRatio - aspectRatio) > 0.001,
  };
}
