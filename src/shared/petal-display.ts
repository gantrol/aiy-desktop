import { z } from 'zod';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';

/** A device-local reading preference, never a document font size or revision. */
export const petalContentScaleSchema = z.number().min(0.75).max(2);
export const PETAL_CONTENT_SCALES = [0.85, 1, 1.15, 1.3, 1.5, 2] as const;
export const PETAL_NOTE_SIZE_PRESETS = {
  small: { width: 280, height: 300 },
  standard: PETAL_WINDOW_SIZES.note,
  large: { width: 480, height: 560 },
} as const;

export function stepPetalContentScale(current: number, direction: -1 | 1): number {
  const scale = petalContentScaleSchema.parse(current);
  const levels = direction === 1 ? PETAL_CONTENT_SCALES : [...PETAL_CONTENT_SCALES].reverse();
  return levels.find((value) => (direction === 1 ? value > scale : value < scale)) ?? scale;
}
