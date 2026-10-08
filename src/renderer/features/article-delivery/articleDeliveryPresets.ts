import { z } from 'zod';
import {
  articleDeliveryPreferencesSchema,
  type ArticleDeliveryPreferences,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';

export const ARTICLE_DELIVERY_PRESET_LIMIT = 20;

const presetSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    preferences: articleDeliveryPreferencesSchema,
  })
  .strict();
const presetsSchema = z
  .object({
    version: z.literal(1),
    presets: z
      .array(presetSchema)
      .max(ARTICLE_DELIVERY_PRESET_LIMIT)
      .refine((presets) => new Set(presets.map((preset) => preset.name)).size === presets.length),
  })
  .strict();
const STORAGE_KEY = 'aiy.article-delivery.presets.v1';
const MAX_STORAGE_LENGTH = 128_000;

export type ArticleDeliveryPreset = z.infer<typeof presetSchema>;

function readPresets(): ArticleDeliveryPreset[] {
  const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
  if (!raw) return [];
  if (raw.length > MAX_STORAGE_LENGTH) throw new Error('DELIVERY_PRESETS_TOO_LARGE');
  return presetsSchema.parse(JSON.parse(raw)).presets;
}

export function readArticleDeliveryPresets(): ArticleDeliveryPreset[] {
  try {
    return readPresets();
  } catch {
    return [];
  }
}

// Read the latest list before each change so two open panes retain each other's presets.
function updatePresets(update: (presets: ArticleDeliveryPreset[]) => ArticleDeliveryPreset[]): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    const value = presetsSchema.parse({ version: 1, presets: update(readPresets()) });
    const raw = JSON.stringify(value);
    if (raw.length > MAX_STORAGE_LENGTH) return false;
    storage.setItem(STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function saveArticleDeliveryPreset(name: string, preferences: ArticleDeliveryPreferences): boolean {
  return updatePresets((presets) => {
    const preset = presetSchema.parse({ name, preferences });
    const index = presets.findIndex((entry) => entry.name === preset.name);
    if (index < 0) return [...presets, preset];
    return presets.map((entry, position) => (position === index ? preset : entry));
  });
}

export function removeArticleDeliveryPreset(name: string): boolean {
  return updatePresets((presets) => presets.filter((preset) => preset.name !== name.trim()));
}
