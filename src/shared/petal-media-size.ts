/** Native window constraints are respected; extreme ratios still use contain, never cropping. */
export function initialPetalMediaSize(media: { width: number; height: number }) {
  if (!Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0)
    return null;
  const ratio = media.width / media.height;
  const width = Math.max(280, Math.min(640, Math.max(360, 284 * ratio + 16)));
  const height = Math.max(300, Math.min(800, (width - 16) / ratio + 16));
  return { width: Math.round(width), height: Math.round(height) };
}
