import { useSyncExternalStore } from 'react';

const storageKey = 'aiy.editor.bracket-associations.v1';
const changedEvent = 'aiy:bracket-associations-changed';
let fallback: boolean | undefined;

export function bracketAssociationsEnabled() {
  if (fallback !== undefined) return fallback;
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function setBracketAssociationsEnabled(enabled: boolean) {
  fallback = enabled;
  try {
    localStorage.setItem(storageKey, String(enabled));
    fallback = undefined;
  } catch {
    // Keep the choice for this renderer when preference storage is unavailable.
  }
  window.dispatchEvent(new Event(changedEvent));
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      fallback = undefined;
      listener();
    }
  };
  window.addEventListener(changedEvent, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changedEvent, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useBracketAssociations() {
  return useSyncExternalStore(subscribe, bracketAssociationsEnabled, () => false);
}
