import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { CanvasPresetDto, Locale } from '@/shared/contracts';

const presetSchema = z.object({
  stableKey: z.string().min(1).max(100),
  ratio: z.string().min(1).max(20),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  nameZh: z.string().min(1).max(120),
  nameEn: z.string().min(1).max(120),
  noteZh: z.string().max(500),
  noteEn: z.string().max(500),
  platformsZh: z.array(z.string().min(1).max(80)).max(20),
  platformsEn: z.array(z.string().min(1).max(80)).max(20),
});

const sourceSchema = z.object({
  schemaVersion: z.string().min(1),
  presets: z.array(presetSchema).min(1).max(100),
});

function assertGptImage2Canvas(width: number, height: number, stableKey: string) {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  const valid =
    width % 16 === 0 &&
    height % 16 === 0 &&
    longEdge <= 3840 &&
    longEdge / shortEdge <= 3 &&
    pixels >= 655_360 &&
    pixels <= 8_294_400;
  if (!valid) throw new Error(`Canvas preset ${stableKey} is outside GPT Image 2 limits`);
}

export function readCanvasPresets(sourcePaths: string | readonly string[], locale: Locale): CanvasPresetDto[] {
  const candidates = typeof sourcePaths === 'string' ? [sourcePaths] : sourcePaths;
  for (const sourcePath of candidates) {
    if (!existsSync(sourcePath)) continue;
    try {
      const source = sourceSchema.parse(JSON.parse(readFileSync(sourcePath, 'utf8')));
      const stableKeys = new Set<string>();
      return source.presets.map((preset) => {
        if (stableKeys.has(preset.stableKey)) throw new Error(`Duplicate canvas preset: ${preset.stableKey}`);
        stableKeys.add(preset.stableKey);
        assertGptImage2Canvas(preset.width, preset.height, preset.stableKey);
        return {
          stableKey: preset.stableKey,
          ratio: preset.ratio,
          width: preset.width,
          height: preset.height,
          name: locale === 'zh' ? preset.nameZh : preset.nameEn,
          note: locale === 'zh' ? preset.noteZh : preset.noteEn,
          platforms: locale === 'zh' ? preset.platformsZh : preset.platformsEn,
        };
      });
    } catch (error) {
      console.warn('[canvas-presets] ignored invalid optional configuration', sourcePath, error);
    }
  }
  return [];
}
