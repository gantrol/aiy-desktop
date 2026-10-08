/** Remove feature-owned recovery caches when upgrading an existing renderer profile. */
export function removeRetiredPreferences() {
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (
        key === 'aiy.reading.positions.v1' ||
        key?.startsWith('aiy.reading-outline.v1:') ||
        key?.startsWith('aiy.content-workspace.outline-reading.')
      )
        storage.removeItem(key);
    }
  } catch {
    // A profile with unavailable storage must still be able to open the app.
  }
}
