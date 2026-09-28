import { articleCoverAspectRatio, type ArticleCoverRatio } from '@/shared/article-covers';
import { textCoverFontFamily } from '@/renderer/features/text-covers/textCoverFonts';
import { textCoverPalettes, type TextCoverRecipe } from '@/renderer/features/text-covers/textCoverPresets';
import { textCoverOrnaments } from '@/renderer/features/text-covers/textCoverOrnaments';
import { fitTextCoverTitle, textCoverMeasure } from '@/renderer/features/text-covers/textCoverTypography';

export interface CoverRect {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}
export interface CoverText {
  kind: 'text';
  x: number;
  y: number;
  value: string;
  size: number;
  weight: number;
  family: string;
  fill: string;
  anchor: 'start' | 'middle' | 'end';
}
export type CoverShape = CoverRect | CoverText;
export interface TextCoverScene {
  width: number;
  height: number;
  shapes: CoverShape[];
  overflow: boolean;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function verticalTitle(title: string, recipe: TextCoverRecipe, width: number, height: number): CoverText[] | null {
  const glyphs = [...segmenter.segment(title.replace(/\s+/gu, ''))].map((item) => item.segment);
  if (glyphs.length > 30 || !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Punctuation}\s]+$/u.test(title))
    return null;
  const block = fitTextCoverTitle(
    title,
    height * 0.72,
    width * 0.65,
    Math.min(88, height * 0.14) * (recipe.scale ?? 1),
    1.6,
    (value, size) => [...segmenter.segment(value)].length * size * 1.2,
  );
  if (block.overflow) return null;
  const { size } = block;
  const columns = block.lines.map((line) => [...segmenter.segment(line)].map((item) => item.segment));
  const perColumn = Math.max(...columns.map((column) => column.length));
  const right = width / 2 + (columns.length - 1) * size * 0.8;
  return columns.flatMap((column, columnIndex) =>
    column.map((value, index): CoverText => ({
      kind: 'text',
      x: right - columnIndex * size * 1.6 - size / 2,
      y: (height - perColumn * size * 1.2) / 2 + index * size * 1.2 + size * 0.88,
      value,
      size,
      weight: recipe.weight,
      family: textCoverFontFamily(recipe.font),
      fill: textCoverPalettes[recipe.palette].ink,
      anchor: 'start',
    })),
  );
}

export function buildTextCoverScene(
  title: string,
  recipe: TextCoverRecipe,
  ratio: ArticleCoverRatio = '4:3',
): TextCoverScene {
  const width = 800;
  const height = width / articleCoverAspectRatio(ratio);
  const palette = textCoverPalettes[recipe.palette];
  const shapes: CoverShape[] = [{ kind: 'rect', x: 0, y: 0, width, height, fill: palette.background }];
  shapes.push(...textCoverOrnaments(recipe.decoration, width, height, palette));
  const cleanTitle = title.replace(/\r\n?/gu, '\n').trim();
  const vertical = recipe.layout === 'vertical' ? verticalTitle(cleanTitle, recipe, width, height) : null;
  if (vertical) return { width, height, shapes: [...shapes, ...vertical], overflow: false };
  const family = textCoverFontFamily(recipe.font);
  const measure = textCoverMeasure(family, recipe.weight);
  const inset = Math.max(
    width * (recipe.inset ?? 0.12),
    recipe.decoration === 'braces' || recipe.decoration === 'quote' ? 110 : 64,
  );
  const areaWidth = width - inset * 2 - (recipe.layout === 'step' ? 56 : 0);
  const paddingY = Math.min(width, height) * 0.16;
  const areaTop = recipe.decoration === 'split' ? height * 0.3 : paddingY;
  const areaHeight = height - areaTop - paddingY;
  const leading = recipe.lineHeight ?? 1.2;
  const block = fitTextCoverTitle(
    cleanTitle.slice(0, 1000),
    areaWidth,
    areaHeight,
    Math.min(156 * (recipe.scale ?? 1), areaHeight),
    leading,
    measure,
  );
  const top =
    recipe.layout === 'bottom' ? height - paddingY - block.height : areaTop + (areaHeight - block.height) * 0.47;
  for (const [index, value] of block.lines.entries()) {
    const measured = measure(value, block.size);
    const anchor =
      recipe.layout === 'center' || recipe.layout === 'vertical'
        ? 'middle'
        : recipe.layout === 'right'
          ? 'end'
          : 'start';
    const x =
      anchor === 'middle'
        ? width / 2
        : anchor === 'end'
          ? width - inset
          : inset + (recipe.layout === 'step' ? (index / Math.max(1, block.lines.length - 1)) * 56 : 0);
    const left = x - (anchor === 'middle' ? measured / 2 : anchor === 'end' ? measured : 0);
    const y = top + index * block.size * leading + block.size * 0.88;
    if (recipe.decoration === 'marker')
      shapes.push({
        kind: 'rect',
        x: left - 6,
        y: y - block.size * 0.3,
        width: measured + 12,
        height: block.size * 0.36,
        fill: palette.soft,
      });
    shapes.push({
      kind: 'text',
      x,
      y,
      value,
      size: block.size,
      weight: recipe.weight,
      family,
      fill: palette.ink,
      anchor,
    });
  }
  return { width, height, shapes, overflow: block.overflow || cleanTitle.length > 1000 };
}
