export const DEFAULT_MEDIA_ASPECT_RATIO = 4 / 3;

/** Keeps an image frame in sync with the source dimensions without cropping. */
export function getSourceMediaAspectRatio(width: number, height: number, fallback = DEFAULT_MEDIA_ASPECT_RATIO) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : fallback;
}
