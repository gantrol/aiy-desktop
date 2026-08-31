const legacyDismissedRunStorageKeys = [
  'aiy.dismissed-generation-errors.v0.3',
  'aiy.dismissed-generation-errors.v1',
] as const;
const maximumLegacyRunIds = 1_000;

function readRunIds(key: string) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(stored)
      ? stored
          .slice(0, maximumLegacyRunIds)
          .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128)
      : [];
  } catch {
    return [];
  }
}

export function loadLegacyDismissedGenerationRunIds() {
  return new Set(legacyDismissedRunStorageKeys.flatMap(readRunIds).slice(0, maximumLegacyRunIds));
}

export function removeLegacyDismissedGenerationRunIds(runIds: readonly string[]) {
  const imported = new Set(runIds);
  if (!imported.size) return;
  for (const key of legacyDismissedRunStorageKeys) {
    try {
      const remaining = readRunIds(key).filter((runId) => !imported.has(runId));
      if (remaining.length) window.localStorage.setItem(key, JSON.stringify(remaining));
      else window.localStorage.removeItem(key);
    } catch {
      // The database acknowledgement is already durable; stale legacy storage is harmless.
    }
  }
}
