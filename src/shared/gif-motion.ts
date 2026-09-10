import type { GifGenerationSettings, GifMotionRegion } from '@/shared/contracts/gif-generation';

export interface GifPixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function gifRegionPixels(region: GifMotionRegion, width: number, height: number): GifPixelRect {
  const x = Math.floor(region.x * width),
    y = Math.floor(region.y * height);
  return {
    x,
    y,
    width: Math.min(width - x, Math.ceil(region.width * width)),
    height: Math.min(height - y, Math.ceil(region.height * height)),
  };
}
export function gifMotionCrop(width: number, height: number, region: GifMotionRegion | null): GifPixelRect {
  if (!region) return { x: 0, y: 0, width, height };
  const area = gifRegionPixels(region, width, height);
  const side = Math.min(Math.max(96, Math.ceil(Math.max(area.width, area.height) * 2)), width, height);
  if (area.width > side || area.height > side) return { x: 0, y: 0, width, height };
  return {
    x: Math.max(0, Math.min(width - side, Math.round(area.x + area.width / 2 - side / 2))),
    y: Math.max(0, Math.min(height - side, Math.round(area.y + area.height / 2 - side / 2))),
    width: side,
    height: side,
  };
}
export function gifSheetLayout(count: number, aspect: number) {
  let best = { columns: count, rows: 1, score: Infinity };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const score = Math.abs(Math.log((aspect * columns) / rows)) + (columns * rows - count) * 0.8;
    if (score < best.score) best = { columns, rows, score };
  }
  return { columns: best.columns, rows: best.rows };
}
export function gifMotionDurations(settings: Pick<GifGenerationSettings, 'keyframes' | 'durationMs'>) {
  const ticks = Math.round(settings.durationMs / 10);
  const weights = Array.from({ length: settings.keyframes + 1 }, (_, i) =>
    i === 0 || i === settings.keyframes ? 3 : 1,
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  const values = weights.map((w) => Math.max(2, Math.floor((ticks * w) / sum)));
  let remaining = ticks - values.reduce((a, b) => a + b, 0);
  for (let i = 0; remaining > 0; i++, remaining--) values[i % values.length]++;
  return values.map((v) => v * 10);
}
