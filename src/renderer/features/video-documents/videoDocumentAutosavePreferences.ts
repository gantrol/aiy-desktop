import { useState } from 'react';
import { z } from 'zod';

const VIDEO_DOCUMENT_AUTOSAVE_STORAGE_KEY = 'aiy.video-documents.autosave.v1';

export const videoDocumentAutosaveDelayMsSchema = z.union([
  z.literal(5_000),
  z.literal(15_000),
  z.literal(30_000),
  z.literal(60_000),
]);

const videoDocumentAutosavePreferencesSchema = z
  .object({
    enabled: z.boolean(),
    delayMs: videoDocumentAutosaveDelayMsSchema,
  })
  .strict();

export type VideoDocumentAutosaveDelayMs = z.infer<typeof videoDocumentAutosaveDelayMsSchema>;
export type VideoDocumentAutosavePreferences = z.infer<typeof videoDocumentAutosavePreferencesSchema>;

const DEFAULT_VIDEO_DOCUMENT_AUTOSAVE_PREFERENCES: VideoDocumentAutosavePreferences = {
  enabled: true,
  delayMs: 15_000,
};

function readVideoDocumentAutosavePreferences(): VideoDocumentAutosavePreferences {
  try {
    const stored = globalThis.localStorage?.getItem(VIDEO_DOCUMENT_AUTOSAVE_STORAGE_KEY);
    if (!stored) return DEFAULT_VIDEO_DOCUMENT_AUTOSAVE_PREFERENCES;
    const parsed = videoDocumentAutosavePreferencesSchema.safeParse(JSON.parse(stored) as unknown);
    return parsed.success ? parsed.data : DEFAULT_VIDEO_DOCUMENT_AUTOSAVE_PREFERENCES;
  } catch {
    return DEFAULT_VIDEO_DOCUMENT_AUTOSAVE_PREFERENCES;
  }
}

function persistVideoDocumentAutosavePreferences(preferences: VideoDocumentAutosavePreferences) {
  try {
    globalThis.localStorage?.setItem(VIDEO_DOCUMENT_AUTOSAVE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The preference remains active for this renderer session when storage is unavailable.
  }
}

export function useVideoDocumentAutosavePreferences() {
  const [preferences, setPreferencesState] = useState(readVideoDocumentAutosavePreferences);

  function setPreferences(next: VideoDocumentAutosavePreferences) {
    const normalized = videoDocumentAutosavePreferencesSchema.parse(next);
    persistVideoDocumentAutosavePreferences(normalized);
    setPreferencesState(normalized);
  }

  return { preferences, setPreferences };
}
