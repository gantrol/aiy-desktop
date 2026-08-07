import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultGalleryPreferences,
  loadGalleryPreferences,
} from '../src/renderer/components/gallery/galleryPreferences';

const currentStorageKey = 'aiy.gallery-preferences.v1';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gallery preference persistence', () => {
  it.each([
    ['CREATION', 'CREATION'],
    ['DICTIONARY', 'DICTIONARY'],
  ] as const)('restores the %s relationship', (_label, relationship) => {
    storage.setItem(
      currentStorageKey,
      JSON.stringify({
        scope: 'ALL',
        relationship,
        contentTypes: ['IMAGE', 'TEXT'],
        assetKinds: [],
        unratedDimensions: [],
        viewMode: 'GRID',
      }),
    );

    const preferences = loadGalleryPreferences();

    expect(preferences).toMatchObject({
      scope: 'ALL',
      relationship,
      contentTypes: ['IMAGE', 'TEXT'],
    });
    expect(preferences).not.toHaveProperty('visibleDimensions');
  });

  it('keeps obsolete rating-card fields out of the current preference model', () => {
    storage.setItem(
      currentStorageKey,
      JSON.stringify({
        visibleDimensions: ['AESTHETIC', 'REALISM'],
      }),
    );

    const preferences = loadGalleryPreferences();

    expect(preferences).toEqual(defaultGalleryPreferences);
    expect(preferences.contentTypes.length).toBeGreaterThan(0);
    expect(preferences).not.toHaveProperty('visibleDimensions');
  });

  it('restores default content types when a persisted value contains an empty selection', () => {
    storage.setItem(
      currentStorageKey,
      JSON.stringify({
        scope: 'FAVORITE',
        relationship: 'ANY',
        contentTypes: [],
        assetKinds: [],
        unratedDimensions: [],
        viewMode: 'LIST',
      }),
    );

    expect(loadGalleryPreferences()).toMatchObject({
      scope: 'FAVORITE',
      contentTypes: ['IMAGE', 'TEXT'],
      viewMode: 'LIST',
    });
  });
});
