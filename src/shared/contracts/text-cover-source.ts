import { z } from 'zod';

// A versioned parameter file, not an executable template or a font bundle.
// Keep v1 identifiers literal: runtime option changes must not silently change
// the file contract. New identifiers need a new version and explicit migration.
// This preserves parameter meanings, not font bytes or pixel-exact rendering.
export const textCoverSourceSchema = z
  .object({
    format: z.literal('aiy.text-cover-source'),
    version: z.literal(1),
    title: z.string().max(1000),
    ratio: z.enum(['1:1', '3:4', '4:3', '16:9', '2.35:1']),
    recipe: z
      .object({
        layout: z.enum(['left', 'center', 'bottom', 'right', 'vertical', 'step']),
        decoration: z.enum([
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
        ]),
        palette: z.enum(['paper', 'chalk', 'ink', 'sage', 'vermilion', 'butter', 'pine', 'blush']),
        font: z.enum([
          'sans',
          'serif',
          'kai',
          'pingfang',
          'dengxian',
          'yahei',
          'songti',
          'simsun',
          'kaitiSc',
          'kaiti',
          'notoSans',
          'notoSerif',
          'wenkai',
        ]),
        weight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]),
        scale: z.number().min(0.5).max(1.5),
        lineHeight: z.number().min(1).max(1.8),
        inset: z.number().min(0.06).max(0.22),
      })
      .strict(),
  })
  .strict();

export type TextCoverSource = z.infer<typeof textCoverSourceSchema>;
