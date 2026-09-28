import { useCallback, useSyncExternalStore } from 'react';

const changed = 'aiy:note-view-preference';
const fallback = new Map<string, boolean>();

/** Device-local chrome choices are shared by note windows, never saved into prose. */
export function useNoteViewPreference(name: 'full-window' | 'applications', defaultValue: boolean) {
  const key = `aiy.notes.${name}.v1`;
  const read = useCallback(() => {
    if (fallback.has(key)) return fallback.get(key)!;
    try {
      const value = localStorage.getItem(key);
      return value === null ? defaultValue : value === 'true';
    } catch {
      return defaultValue;
    }
  }, [key, defaultValue]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const storage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) {
          fallback.delete(key);
          listener();
        }
      };
      window.addEventListener(changed, listener);
      window.addEventListener('storage', storage);
      return () => {
        window.removeEventListener(changed, listener);
        window.removeEventListener('storage', storage);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(subscribe, read, () => defaultValue);
  const update = useCallback(
    (next: boolean) => {
      fallback.set(key, next);
      try {
        localStorage.setItem(key, String(next));
        fallback.delete(key);
      } catch {
        // Keep the choice for this window if browser preference storage is unavailable.
      }
      window.dispatchEvent(new Event(changed));
    },
    [key],
  );
  return [value, update] as const;
}
