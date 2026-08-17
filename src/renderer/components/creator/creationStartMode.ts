export type CreationStartMode = 'image' | 'video-document';

const CREATION_START_MODE_STORAGE_KEY = 'aiy.creation-start-mode.v1';

export function readCreationStartMode(): CreationStartMode {
  try {
    return globalThis.localStorage?.getItem(CREATION_START_MODE_STORAGE_KEY) === 'video-document'
      ? 'video-document'
      : 'image';
  } catch {
    return 'image';
  }
}

export function writeCreationStartMode(mode: CreationStartMode) {
  try {
    globalThis.localStorage?.setItem(CREATION_START_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in restricted renderer contexts; the in-memory selection still applies.
  }
}
