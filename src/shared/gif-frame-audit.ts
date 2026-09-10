import type { GifFrameAudit } from '@/shared/contracts/gif-motion-plan';
import type { GifPixelRect } from '@/shared/gif-motion';

/** Bounded pixel similarity evidence. This is not a semantic motion-quality verdict. */
export function sampleGifState(pixels: Uint8ClampedArray, width: number, box: GifPixelRect) {
  const columns = Math.min(96, box.width),
    rows = Math.min(96, box.height);
  const sample = new Uint8Array(columns * rows * 3);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const p =
        ((box.y + Math.floor((y * box.height) / rows)) * width + box.x + Math.floor((x * box.width) / columns)) * 4;
      const q = (y * columns + x) * 3;
      sample[q] = pixels[p];
      sample[q + 1] = pixels[p + 1];
      sample[q + 2] = pixels[p + 2];
    }
  return sample;
}
export function auditGifStates(samples: Uint8Array[], local: boolean): GifFrameAudit {
  const unique: Uint8Array[] = [];
  const duplicateStates: number[] = [];
  const similar = (a: Uint8Array, b: Uint8Array) => {
    const mean = [0, 0, 0];
    if (local) for (let p = 0; p < a.length; p++) mean[p % 3] += (a[p] - b[p]) / (a.length / 3);
    let changed = 0;
    for (let p = 0; p < a.length; p += 3)
      if ([0, 1, 2].some((c) => Math.abs(a[p + c] - b[p + c] - mean[c]) > 6)) changed++;
    return changed / (a.length / 3) < 0.02;
  };
  samples.forEach((sample, i) => {
    if (unique.some((other) => similar(sample, other))) duplicateStates.push(i);
    else unique.push(sample);
  });
  return { plannedStates: samples.length, distinctStates: unique.length, duplicateStates };
}
