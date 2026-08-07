import {
  chooseImageOverlayTone,
  sampleImageOverlayAnalysis,
  sampleImageOverlayTone,
  type ImageOverlayAnalysis,
  type ImageOverlaySampleRegion,
  type ImageOverlaySource,
  type ImageOverlayTone,
} from '@/renderer/components/media/imageOverlayTone';

export type MaterialOverlayTone = ImageOverlayTone;
export type MaterialOverlayAnalysis = ImageOverlayAnalysis;
export type MaterialOverlaySampleRegion = ImageOverlaySampleRegion;
export const chooseMaterialOverlayTone = chooseImageOverlayTone;
export const sampleMaterialOverlayAnalysis = sampleImageOverlayAnalysis;
export const sampleMaterialOverlayTone = sampleImageOverlayTone;

type SampleBounds = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

function relativeSampleRegion(frame: DOMRect, sample: SampleBounds): MaterialOverlaySampleRegion {
  return {
    left: (sample.left - frame.left) / frame.width,
    top: (sample.top - frame.top) / frame.height,
    width: (sample.right - sample.left) / frame.width,
    height: (sample.bottom - sample.top) / frame.height,
  };
}

function unionSampleBounds(elements: readonly Element[], padding: number): SampleBounds | null {
  const rectangles = elements
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width && rect.height);
  if (!rectangles.length) return null;
  return {
    left: Math.min(...rectangles.map((rect) => rect.left)) - padding,
    top: Math.min(...rectangles.map((rect) => rect.top)) - padding,
    right: Math.max(...rectangles.map((rect) => rect.right)) + padding,
    bottom: Math.max(...rectangles.map((rect) => rect.bottom)) + padding,
  };
}

/**
 * Samples the actual left-copy and date bounds instead of averaging the whole
 * card footer.
 *
 * Every sample is a `drawImage` plus a synchronous `getImageData` readback, so
 * the whole-footer fallback is computed lazily and only when a region is
 * actually missing. A card with both regions present now costs two readbacks
 * on image load instead of three.
 */
export function sampleMaterialCardOverlay(image: ImageOverlaySource): {
  primary: MaterialOverlayAnalysis;
  date: MaterialOverlayAnalysis;
} {
  let fallbackAnalysis: MaterialOverlayAnalysis | null = null;
  const fallback = () => (fallbackAnalysis ??= sampleMaterialOverlayAnalysis(image));

  const frame = image.parentElement;
  const overlay = frame?.querySelector('[data-material-overlay]');
  if (!frame || !overlay) return { primary: fallback(), date: fallback() };

  const frameRect = frame.getBoundingClientRect();
  if (!frameRect.width || !frameRect.height) return { primary: fallback(), date: fallback() };
  const primaryBounds = unionSampleBounds(
    Array.from(overlay.querySelectorAll('[data-material-overlay-primary-copy]')),
    3,
  );
  const dateElement = overlay.querySelector('[data-material-overlay-date]');
  const dateBounds = dateElement ? unionSampleBounds([dateElement], 3) : null;

  return {
    primary: primaryBounds
      ? sampleMaterialOverlayAnalysis(image, relativeSampleRegion(frameRect, primaryBounds))
      : fallback(),
    date: dateBounds ? sampleMaterialOverlayAnalysis(image, relativeSampleRegion(frameRect, dateBounds)) : fallback(),
  };
}
