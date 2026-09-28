import type { CoverRect } from '@/renderer/features/text-covers/textCoverScene';
import type { TextCoverDecoration } from '@/renderer/features/text-covers/textCoverPresets';

export function textCoverOrnaments(
  decoration: TextCoverDecoration,
  width: number,
  height: number,
  palette: { ink: string; accent: string; soft: string },
): CoverRect[] {
  const rect = (x: number, y: number, w: number, h: number, fill = palette.accent): CoverRect => ({
    kind: 'rect',
    x,
    y,
    width: w,
    height: h,
    fill,
  });
  switch (decoration) {
    case 'rule':
      return [rect(80, height * 0.12, 72, 6), rect(width - 152, height * 0.88, 72, 3)];
    case 'spine':
      return [rect(0, 0, 22, height), rect(40, 0, 2, height, palette.ink)];
    case 'frame':
      return [
        rect(35, 35, width - 70, 2),
        rect(35, height - 37, width - 70, 2),
        rect(35, 35, 2, height - 70),
        rect(width - 37, 35, 2, height - 70),
      ];
    case 'corners':
      return [
        rect(42, 42, 100, 3),
        rect(42, 42, 3, 42),
        rect(width - 142, height - 45, 100, 3),
        rect(width - 45, height - 84, 3, 42),
      ];
    case 'split':
      return [rect(0, 0, width, height * 0.25, palette.soft), rect(80, height * 0.25 - 8, 72, 16)];
    case 'quote':
      return [
        rect(55, height * 0.16, 12, 42),
        rect(76, height * 0.16, 12, 28),
        rect(width - 88, height * 0.84 - 28, 12, 28),
        rect(width - 67, height * 0.84 - 42, 12, 42),
      ];
    case 'ruled':
      return [
        rect(64, height * 0.12, width - 128, 3),
        rect(64, height * 0.12 + 9, width - 128, 1),
        rect(64, height * 0.88, width - 128, 2),
      ];
    case 'braces':
      return [
        rect(52, height * 0.24, 5, height * 0.52),
        rect(52, height * 0.24, 26, 5),
        rect(52, height * 0.76 - 5, 26, 5),
        rect(width - 57, height * 0.24, 5, height * 0.52),
        rect(width - 78, height * 0.24, 26, 5),
        rect(width - 78, height * 0.76 - 5, 26, 5),
      ];
    default:
      return [];
  }
}
