export const PRODUCT_NAMES = {
  en: 'AIY',
  zh: 'AIY',
} as const;

export const DEFAULT_PRODUCT_NAME = PRODUCT_NAMES.en;

export function productNameForLocale(locale: string) {
  return locale.toLowerCase().startsWith('zh') ? PRODUCT_NAMES.zh : PRODUCT_NAMES.en;
}

// This versions the extension-host API, not the desktop package. Keep it stable
// across app releases unless extension compatibility actually changes.
export const EXTENSION_HOST_VERSION = '0.3.9';
export const EXTENSION_HOST_ENGINE_KEY = 'aiy' as const;
export type ExtensionHostEngineKey = typeof EXTENSION_HOST_ENGINE_KEY;

export const USER_DATA_DIRECTORY_NAME = 'AIY';
export const STORE_USER_DATA_DIRECTORY_NAME = 'AIY-Store';
export const BROWSER_COMPANION_DATA_DIRECTORY_NAME = 'AIY-Companion';
