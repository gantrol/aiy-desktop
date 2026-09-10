import type { GifFrame, GifManifest } from '@/shared/contracts/gif-making';

/** Shared canvas geometry for the editor and the isolated export renderer. */
export function gifImagePlacement(
  manifest: GifManifest,
  source: { width: number; height: number },
  frame: GifFrame | null,
  background = false,
) {
  const crop = frame?.sourceRect ?? { x: 0, y: 0, width: source.width, height: source.height };
  if (crop.x + crop.width > source.width || crop.y + crop.height > source.height) throw new Error('GIF_INVALID');
  const fit = background ? 'COVER' : manifest.fit;
  const ratio = (fit === 'COVER' ? Math.max : Math.min)(manifest.width / crop.width, manifest.height / crop.height);
  const scale = background ? 1 : manifest.foreground.scale;
  const width = crop.width * ratio * scale;
  const height = crop.height * ratio * scale;
  return {
    crop,
    width,
    height,
    x: (manifest.width - width) / 2 + (background ? 0 : manifest.foreground.x * manifest.width),
    y: (manifest.height - height) / 2 + (background ? 0 : manifest.foreground.y * manifest.height),
  };
}
