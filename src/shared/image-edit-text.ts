import type { ImageEditMark } from '@/shared/contracts/image-edit';

/** The SVG preview and exported bitmap share the same text wrapping. */
export function imageTextLines(mark: ImageEditMark, measure: (text: string) => number): string[] {
  if (!mark.wrap) return mark.text.split('\n');
  const lines: string[] = [];
  for (const paragraph of mark.text.split('\n')) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character) > Math.abs(mark.width)) {
        lines.push(line);
        line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}
