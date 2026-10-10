import type { ImageEditMark } from '@/shared/contracts/image-edit';
import { imageTextLines } from '@/shared/image-edit-text';

let context: CanvasRenderingContext2D | null | undefined;
export function textLines(mark: ImageEditMark) {
  context ??= document.createElement('canvas').getContext('2d');
  if (context) context.font = `${mark.fontSize}px ${mark.fontFamily ?? 'sans-serif'}`;
  return imageTextLines(mark, (text) => context?.measureText(text).width ?? text.length * mark.fontSize);
}

export function fitTextHeight(mark: ImageEditMark): ImageEditMark {
  return { ...mark, height: Math.min(32768, Math.max(1, textLines(mark).length) * mark.fontSize * 1.25) };
}
