import { useSyncExternalStore } from 'react';
import { z } from 'zod';

export const materialLayoutPreferencesSchema = z.object({
  arrangement: z.enum(['ROWS', 'COLUMNS']).catch('ROWS'),
  size: z.number().min(120).max(320).catch(204),
  showNames: z.boolean().catch(false),
});

export type MaterialLayoutPreferences = z.infer<typeof materialLayoutPreferencesSchema>;
export const defaultMaterialLayoutPreferences: MaterialLayoutPreferences = {
  arrangement: 'ROWS',
  size: 204,
  showNames: false,
};

const storageKey = 'aiy.material-layout.v1';
const changeEvent = 'aiy:material-layout-change';
let snapshot: MaterialLayoutPreferences | undefined;

function readPreferences(): MaterialLayoutPreferences {
  try {
    const parsed = materialLayoutPreferencesSchema.safeParse(
      JSON.parse(window.localStorage.getItem(storageKey) ?? '{}'),
    );
    return parsed.success ? parsed.data : defaultMaterialLayoutPreferences;
  } catch {
    return defaultMaterialLayoutPreferences;
  }
}

function getSnapshot() {
  return (snapshot ??= readPreferences());
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== storageKey) return;
    snapshot = readPreferences();
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

function updatePreferences(patch: Partial<MaterialLayoutPreferences>) {
  snapshot = materialLayoutPreferencesSchema.parse({ ...getSnapshot(), ...patch });
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // Keep the current session usable when renderer storage is unavailable.
  }
  window.dispatchEvent(new Event(changeEvent));
}

/** Image arrangement is independent of filters and the creator's GRID/LIST stack view. */
export function useMaterialLayoutPreferences() {
  const preferences = useSyncExternalStore(subscribe, getSnapshot);
  return { preferences, updatePreferences };
}
