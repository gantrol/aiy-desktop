import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { DerivedVisualPromptTemplatesDto, Locale } from '@/shared/contracts';

const templatesSchema = z
  .object({
    articleHeader: z.string().min(1).max(30_000),
    articleInline: z.string().min(1).max(30_000),
    socialCover: z.string().min(1).max(30_000),
    compositionConstraints: z.record(z.string().min(1).max(240), z.string().min(1).max(2_000)),
  })
  .strict();

const sourceSchema = z
  .object({
    schemaVersion: z.string().min(1),
    locales: z.object({ zh: templatesSchema, en: templatesSchema }).strict(),
  })
  .strict();

const emptyTemplates: DerivedVisualPromptTemplatesDto = {
  articleHeader: '',
  articleInline: '',
  socialCover: '',
  compositionConstraints: {},
};

export function readDerivedVisualPrompts(
  sourcePaths: string | readonly string[],
  locale: Locale,
): DerivedVisualPromptTemplatesDto {
  const candidates = typeof sourcePaths === 'string' ? [sourcePaths] : sourcePaths;
  for (const sourcePath of candidates) {
    if (!existsSync(sourcePath)) continue;
    try {
      const source = sourceSchema.parse(JSON.parse(readFileSync(sourcePath, 'utf8')) as unknown);
      return source.locales[locale];
    } catch (error) {
      console.warn('[derived-visual-prompts] ignored invalid optional configuration', sourcePath, error);
    }
  }
  return emptyTemplates;
}
