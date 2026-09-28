import { z } from 'zod';
import type { ResultLibraryMode } from '@/renderer/components/creator/ResultLibrary';

export interface CreatorPreferences {
  resultLibraryMode: ResultLibraryMode;
  resultLibraryView: 'full' | 'outline';
  resultPanelWidth: number;
  outputPanelRatio: number;
  outputCollapsed: boolean;
}

const storageKey = 'aiy.creator-preferences.v1';
const resultLibraryModes = ['full', 'images', 'outline'] as const satisfies readonly ResultLibraryMode[];
const storedCreatorPreferencesSchema = z
  .object({
    resultLibraryView: z.enum(['full', 'outline']).optional().catch(undefined),
    resultLibraryMode: z.enum(resultLibraryModes).optional().catch(undefined),
    resultPanelWidth: z.number().finite().optional().catch(undefined),
    outputPanelRatio: z.number().finite().optional().catch(undefined),
    outputCollapsed: z.boolean().optional().catch(undefined),
  })
  .passthrough();

export const resultThumbnailWidth = 52;
export const outputThumbnailWidth = resultThumbnailWidth;
export const minimumCenterWidth = 480;
export const minimumResultListWidth = 240;
export const minimumOutputWidth = 280;
export const defaultOutputPanelRatio = 0.515;
export const minimumOutputPanelRatio = 0.35;
export const maximumOutputPanelRatio = 0.65;

export const defaultCreatorPreferences: CreatorPreferences = {
  resultLibraryMode: 'images',
  resultLibraryView: 'full',
  resultPanelWidth: 258,
  outputPanelRatio: defaultOutputPanelRatio,
  outputCollapsed: false,
};

function width(value: unknown, minimum: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? Math.round(value) : fallback;
}

function ratio(value: unknown, fallback: number) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimumOutputPanelRatio &&
    value <= maximumOutputPanelRatio
    ? value
    : fallback;
}

function normalize(value: unknown): CreatorPreferences {
  const parsed = storedCreatorPreferencesSchema.safeParse(value);
  const stored = parsed.success ? parsed.data : {};
  return {
    resultLibraryView: stored.resultLibraryView ?? (stored.resultLibraryMode === 'outline' ? 'outline' : 'full'),
    resultLibraryMode: stored.resultLibraryMode ?? defaultCreatorPreferences.resultLibraryMode,
    resultPanelWidth: width(
      stored.resultPanelWidth,
      minimumResultListWidth,
      defaultCreatorPreferences.resultPanelWidth,
    ),
    outputPanelRatio: ratio(stored.outputPanelRatio, defaultCreatorPreferences.outputPanelRatio),
    outputCollapsed: stored.outputCollapsed ?? defaultCreatorPreferences.outputCollapsed,
  };
}

export function loadCreatorPreferences(scope?: string): CreatorPreferences {
  try {
    const stored =
      window.localStorage.getItem(scope ? `${storageKey}:${scope}` : storageKey) ??
      window.localStorage.getItem(storageKey);
    return stored ? normalize(JSON.parse(stored) as unknown) : defaultCreatorPreferences;
  } catch {
    return defaultCreatorPreferences;
  }
}

export function saveCreatorPreferences(preferences: CreatorPreferences, scope?: string) {
  try {
    window.localStorage.setItem(scope ? `${storageKey}:${scope}` : storageKey, JSON.stringify(normalize(preferences)));
  } catch {
    // The creator remains usable when renderer storage is unavailable.
  }
}
