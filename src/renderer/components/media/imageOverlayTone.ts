export type ImageOverlayTone = 'light' | 'dark';

export interface ImageOverlaySampleRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageOverlayAnalysis {
  tone: ImageOverlayTone;
  needsContrastSupport: boolean;
}

export type ImageOverlaySource = HTMLImageElement | HTMLVideoElement;

const AA_SMALL_TEXT_CONTRAST = 4.5;
const LOWER_CONTRAST_PERCENTILE = 0.2;
const LIGHT_FOREGROUND_LUMINANCE = 1;
const MINIMUM_UNSUPPORTED_AA_COVERAGE = 0.8;
const MINIMUM_UNSUPPORTED_LOWER_CONTRAST = 3;
const DEFAULT_SAMPLE_REGION: ImageOverlaySampleRegion = { left: 0, top: 0.7, width: 1, height: 0.3 };

function linearChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(red: number, green: number, blue: number) {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

// --media-surround-dark is --neutral-900 (#1c1c1c) in both supported shells.
const DARK_FOREGROUND_LUMINANCE = relativeLuminance(28, 28, 28);

function contrastRatio(left: number, right: number) {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function percentile(sorted: readonly number[], position: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction;
}

/**
 * Scores a foreground against the full text region instead of its average
 * color. AA coverage rewards broad readability; the lower percentile prevents
 * a small but meaningful opposing patch from disappearing in the average.
 */
function readabilityMetrics(backgrounds: readonly number[], foreground: number) {
  const contrasts = backgrounds.map((background) => contrastRatio(background, foreground)).sort((a, b) => a - b);
  const aaCoverage =
    contrasts.reduce((count, contrast) => count + Number(contrast >= AA_SMALL_TEXT_CONTRAST), 0) / contrasts.length;
  const lowerContrast = percentile(contrasts, LOWER_CONTRAST_PERCENTILE);
  const medianContrast = percentile(contrasts, 0.5);

  return {
    aaCoverage,
    lowerContrast,
    score:
      aaCoverage * 3 +
      (Math.min(lowerContrast, AA_SMALL_TEXT_CONTRAST) / AA_SMALL_TEXT_CONTRAST) * 2 +
      Math.min(medianContrast, 7) / 7,
  };
}

function analyzeBackgrounds(backgrounds: readonly number[]): ImageOverlayAnalysis {
  if (!backgrounds.length) return { tone: 'light', needsContrastSupport: true };
  const light = readabilityMetrics(backgrounds, LIGHT_FOREGROUND_LUMINANCE);
  const dark = readabilityMetrics(backgrounds, DARK_FOREGROUND_LUMINANCE);
  const tone = dark.score > light.score ? 'dark' : 'light';
  const selected = tone === 'dark' ? dark : light;
  return {
    tone,
    needsContrastSupport:
      selected.aaCoverage < MINIMUM_UNSUPPORTED_AA_COVERAGE ||
      selected.lowerContrast < MINIMUM_UNSUPPORTED_LOWER_CONTRAST,
  };
}

/** Chooses the tokenized light or dark foreground with the safer regional contrast. */
export function chooseImageOverlayTone(pixels: ArrayLike<number>): ImageOverlayTone {
  const backgrounds: number[] = [];
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    backgrounds.push(relativeLuminance(pixels[index], pixels[index + 1], pixels[index + 2]));
  }

  return analyzeBackgrounds(backgrounds).tone;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeSampleRegion(region: ImageOverlaySampleRegion): ImageOverlaySampleRegion {
  const left = clamp(region.left, 0, 1);
  const top = clamp(region.top, 0, 1);
  return {
    left,
    top,
    width: clamp(region.width, 0, 1 - left),
    height: clamp(region.height, 0, 1 - top),
  };
}

/** Samples an image region and reports whether the chosen tone still needs a contrast halo. */
export function sampleImageOverlayAnalysis(
  image: ImageOverlaySource,
  sampleRegion: ImageOverlaySampleRegion = DEFAULT_SAMPLE_REGION,
): ImageOverlayAnalysis {
  const video = typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement;
  const sourceWidth = video ? image.videoWidth : (image as HTMLImageElement).naturalWidth;
  const sourceHeight = video ? image.videoHeight : (image as HTMLImageElement).naturalHeight;
  if (!sourceWidth || !sourceHeight || typeof document === 'undefined') {
    return { tone: 'light', needsContrastSupport: true };
  }

  const region = normalizeSampleRegion(sampleRegion);
  if (!region.width || !region.height) return { tone: 'light', needsContrastSupport: true };
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 18;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { tone: 'light', needsContrastSupport: true };

  try {
    context.drawImage(
      image,
      sourceWidth * region.left,
      sourceHeight * region.top,
      sourceWidth * region.width,
      sourceHeight * region.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const backgrounds: number[] = [];
    for (let index = 0; index + 3 < pixels.length; index += 4) {
      if (pixels[index + 3] < 128) continue;
      backgrounds.push(relativeLuminance(pixels[index], pixels[index + 1], pixels[index + 2]));
    }
    return analyzeBackgrounds(backgrounds);
  } catch {
    // External media schemes can forbid canvas reads. Preserve a stable,
    // tokenized foreground rather than surfacing an image-rendering failure.
    return { tone: 'light', needsContrastSupport: true };
  }
}

/** Samples the lower 30% occupied by image-card and tooltip copy. */
export function sampleImageOverlayTone(image: ImageOverlaySource): ImageOverlayTone {
  return sampleImageOverlayAnalysis(image).tone;
}
