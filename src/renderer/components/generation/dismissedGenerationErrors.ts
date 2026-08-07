const dismissedRunStorageKey = 'aiy.dismissed-generation-errors.v1';

export function loadDismissedGenerationRunIds() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(dismissedRunStorageKey) ?? '[]') as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

export function saveDismissedGenerationRunIds(runIds: Set<string>) {
  try {
    window.localStorage.setItem(dismissedRunStorageKey, JSON.stringify([...runIds]));
  } catch {
    // Failure history remains usable when renderer storage is unavailable.
  }
}
