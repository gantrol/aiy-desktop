import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';

/** The original heart slot plus its always-reserved caption row, in CSS pixels. */
export const PETAL_SHAPE_LAYOUT = { width: 66, height: 82, captionHeight: 16 } as const;
export const PETAL_SHAPE_ANCHOR = {
  x: PETAL_WINDOW_SIZES.collapsed.width / 2,
  y: (PETAL_WINDOW_SIZES.collapsed.height - PETAL_SHAPE_LAYOUT.captionHeight) / 2,
};
