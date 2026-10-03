import type { TextCoverPalette } from '@/shared/text-cover-palettes';
export { textCoverPalettes } from '@/shared/text-cover-palettes';

export const textCoverLayouts = ['left', 'center', 'bottom', 'right', 'vertical', 'step'] as const;
export type TextCoverLayout = (typeof textCoverLayouts)[number];
export const textCoverDecorations = [
  'none',
  'rule',
  'spine',
  'frame',
  'corners',
  'marker',
  'split',
  'quote',
  'ruled',
  'braces',
] as const;
export type TextCoverDecoration = (typeof textCoverDecorations)[number];

export type TextCoverFont = 'sans' | 'serif' | 'kai';
export interface TextCoverRecipe {
  layout: TextCoverLayout;
  decoration: TextCoverDecoration;
  palette: TextCoverPalette;
  font: string;
  weight: number;
  scale?: number;
  lineHeight?: number;
  inset?: number;
}

export const textCoverPresets = [
  {
    id: 'editorial',
    layout: 'left',
    decoration: 'none',
    palette: 'paper',
    font: 'sans',
    weight: 700,
    scale: 1,
    lineHeight: 1.18,
    inset: 0.11,
  },
  {
    id: 'quiet',
    layout: 'center',
    decoration: 'none',
    palette: 'chalk',
    font: 'sans',
    weight: 400,
    scale: 0.88,
    lineHeight: 1.32,
    inset: 0.14,
  },
  {
    id: 'swiss',
    layout: 'right',
    decoration: 'none',
    palette: 'sage',
    font: 'sans',
    weight: 500,
    scale: 0.96,
    lineHeight: 1.24,
    inset: 0.12,
  },
  {
    id: 'bold',
    layout: 'left',
    decoration: 'none',
    palette: 'ink',
    font: 'sans',
    weight: 700,
    scale: 1.18,
    lineHeight: 1.08,
    inset: 0.08,
  },
  {
    id: 'spine',
    layout: 'bottom',
    decoration: 'spine',
    palette: 'paper',
    font: 'serif',
    weight: 400,
    scale: 0.9,
    lineHeight: 1.3,
    inset: 0.14,
  },
  {
    id: 'vertical',
    layout: 'vertical',
    decoration: 'none',
    palette: 'blush',
    font: 'serif',
    weight: 400,
    scale: 1,
    lineHeight: 1.32,
    inset: 0.15,
  },
  {
    id: 'book',
    layout: 'center',
    decoration: 'none',
    palette: 'paper',
    font: 'serif',
    weight: 400,
    scale: 0.94,
    lineHeight: 1.36,
    inset: 0.14,
  },
  {
    id: 'chapter',
    layout: 'bottom',
    decoration: 'none',
    palette: 'chalk',
    font: 'sans',
    weight: 400,
    scale: 0.88,
    lineHeight: 1.3,
    inset: 0.14,
  },
  {
    id: 'poster',
    layout: 'center',
    decoration: 'none',
    palette: 'vermilion',
    font: 'sans',
    weight: 700,
    scale: 1.18,
    lineHeight: 1.08,
    inset: 0.09,
  },
  {
    id: 'highlight',
    layout: 'left',
    decoration: 'marker',
    palette: 'butter',
    font: 'sans',
    weight: 700,
    scale: 0.94,
    lineHeight: 1.28,
    inset: 0.12,
  },
  {
    id: 'duotone',
    layout: 'bottom',
    decoration: 'split',
    palette: 'sage',
    font: 'sans',
    weight: 500,
    scale: 0.96,
    lineHeight: 1.22,
    inset: 0.12,
  },
  {
    id: 'quotation',
    layout: 'center',
    decoration: 'none',
    palette: 'paper',
    font: 'kai',
    weight: 400,
    scale: 0.92,
    lineHeight: 1.36,
    inset: 0.15,
  },
  {
    id: 'notebook',
    layout: 'left',
    decoration: 'none',
    palette: 'chalk',
    font: 'kai',
    weight: 400,
    scale: 0.88,
    lineHeight: 1.42,
    inset: 0.12,
  },
  {
    id: 'letter',
    layout: 'right',
    decoration: 'none',
    palette: 'blush',
    font: 'serif',
    weight: 400,
    scale: 0.88,
    lineHeight: 1.36,
    inset: 0.13,
  },
  {
    id: 'handwritten',
    layout: 'step',
    decoration: 'none',
    palette: 'butter',
    font: 'kai',
    weight: 400,
    scale: 0.9,
    lineHeight: 1.38,
    inset: 0.12,
  },
  {
    id: 'essay',
    layout: 'left',
    decoration: 'none',
    palette: 'sage',
    font: 'serif',
    weight: 400,
    scale: 0.86,
    lineHeight: 1.36,
    inset: 0.13,
  },
  {
    id: 'archive',
    layout: 'bottom',
    decoration: 'rule',
    palette: 'paper',
    font: 'sans',
    weight: 500,
    scale: 0.98,
    lineHeight: 1.22,
    inset: 0.12,
  },
  {
    id: 'technical',
    layout: 'left',
    decoration: 'none',
    palette: 'ink',
    // Built-in presets must remain editable and importable without a local font.
    font: 'sans',
    weight: 700,
    scale: 1.08,
    lineHeight: 1.16,
    inset: 0.1,
  },
  {
    id: 'newspaper',
    layout: 'left',
    decoration: 'ruled',
    palette: 'paper',
    font: 'serif',
    weight: 700,
    scale: 1.05,
    lineHeight: 1.22,
    inset: 0.12,
  },
  {
    id: 'flow',
    layout: 'step',
    decoration: 'none',
    palette: 'pine',
    font: 'sans',
    weight: 500,
    scale: 0.98,
    lineHeight: 1.22,
    inset: 0.11,
  },
] as const satisfies readonly (TextCoverRecipe & { id: string })[];
export type TextCoverPresetId = (typeof textCoverPresets)[number]['id'];

export function textCoverSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return hash >>> 0;
}

export function automaticTextCover(seed: string): TextCoverRecipe {
  const hash = textCoverSeed(seed);
  const preset = textCoverPresets[hash % textCoverPresets.length];
  return { ...preset };
}
