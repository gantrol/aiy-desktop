import { articleCoverCropRect, type ArticleCoverCrop, type ArticleCoverRatio } from '@/shared/article-covers';

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** Keep the image point under the pointer fixed while the crop window zooms. */
export function zoomArticleCover(
  width: number,
  height: number,
  ratio: ArticleCoverRatio,
  crop: ArticleCoverCrop,
  zoom: number,
  anchor = { x: 0.5, y: 0.5 },
): ArticleCoverCrop {
  const current = articleCoverCropRect(width, height, ratio, crop);
  const next = { ...crop, zoom: clamp(zoom, 1, 4) };
  const rect = articleCoverCropRect(width, height, ratio, next);
  return {
    ...next,
    x: width > rect.width ? clamp((current.x + (current.width - rect.width) * anchor.x) / (width - rect.width)) : 0.5,
    y:
      height > rect.height
        ? clamp((current.y + (current.height - rect.height) * anchor.y) / (height - rect.height))
        : 0.5,
  };
}

export function panArticleCover(
  width: number,
  height: number,
  ratio: ArticleCoverRatio,
  crop: ArticleCoverCrop,
  deltaX: number,
  deltaY: number,
): ArticleCoverCrop {
  const rect = articleCoverCropRect(width, height, ratio, crop);
  return {
    ...crop,
    x: width > rect.width ? clamp(crop.x - deltaX / (width - rect.width)) : 0.5,
    y: height > rect.height ? clamp(crop.y - deltaY / (height - rect.height)) : 0.5,
  };
}
