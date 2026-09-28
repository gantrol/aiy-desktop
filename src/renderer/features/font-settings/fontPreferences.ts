import { useSyncExternalStore } from 'react';

export const fontRoles = ['ui', 'content', 'mono'] as const;
export type FontRole = (typeof fontRoles)[number];
export type FontPreferences = Record<FontRole, string | null>;
const defaults: FontPreferences = { ui: null, content: null, mono: null };
const storageKey = 'aiy.fonts.v1';
const changedEvent = 'aiy:fonts-changed';
let cachedRaw: string | null | undefined;
let cached = defaults;
let memory: FontPreferences | undefined;

export function validFontFamily(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function quotedFontFamily(family: string) {
  return `"${family.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function snapshot(): FontPreferences {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = { ...defaults };
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object') {
      for (const role of fontRoles) {
        const family = (value as Record<string, unknown>)[role];
        if (validFontFamily(family)) cached[role] = family.trim();
      }
    }
  } catch {
    // A damaged or unavailable preference never prevents the renderer opening.
    cached = defaults;
  }
  return cached;
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      memory = undefined;
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

export function setFontPreference(role: FontRole, family: string | null) {
  if (family !== null && !validFontFamily(family)) return;
  memory = { ...snapshot(), [role]: family?.trim() ?? null };
  try {
    localStorage.setItem(storageKey, JSON.stringify(memory));
    memory = undefined;
  } catch {
    // Keep the choice in this window if preference storage is unavailable.
  }
  window.dispatchEvent(new Event(changedEvent));
}

export function useFontPreferences() {
  return useSyncExternalStore(subscribe, snapshot, () => defaults);
}

/** Applied before React mounts, and shared by all renderer windows via storage events. */
export function installFontPreferences() {
  const apply = () => {
    const preferences = snapshot();
    const targets = {
      ui: ['--font-ui', 'var(--font-ui-default)'],
      content: ['--font-content', 'var(--font-ui)'],
      mono: ['--font-mono-family', 'var(--font-mono-default)'],
    };
    for (const role of fontRoles) {
      const [property, fallback] = targets[role];
      const family = preferences[role];
      if (family) document.documentElement.style.setProperty(property, `${quotedFontFamily(family)}, ${fallback}`);
      else document.documentElement.style.removeProperty(property);
    }
  };
  apply();
  return subscribe(apply);
}
