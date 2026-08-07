import { afterAll, bench, describe } from 'vitest';
import type { DictionaryPageInput, GalleryListInput } from '../src/shared/contracts';
import { createTestLibrary } from '../tests/support/test-library';

/**
 * Storage microbenchmarks.
 *
 * The database layer is the only part of the product whose cost grows with the
 * user's library, and nothing currently characterises that growth. The pairs
 * below expose shape rather than absolute speed: a first page and a deep page of
 * the same query answer "does this degrade linearly?" — the question a user with
 * 50,000 assets is really asking.
 *
 * Not a gate. Compare medians across runs on one machine; CI numbers are noise.
 * Seed the fixture library harder before reading anything into the results — a
 * near-empty database makes every query look free.
 */
const dictionaryPage = (overrides: Partial<DictionaryPageInput> = {}): DictionaryPageInput => ({
  locale: 'zh',
  query: '',
  facetValueIds: [],
  excludeDrafts: false,
  excludeUncited: false,
  includeArchived: false,
  offset: 0,
  limit: 40,
  ...overrides,
});

const galleryPage = (overrides: Partial<GalleryListInput> = {}): GalleryListInput => ({
  locale: 'zh',
  source: 'ALL',
  unratedDimensions: [],
  cursor: null,
  limit: 60,
  ...overrides,
});

describe('dictionary paging', () => {
  const library = createTestLibrary('aiy-bench-dictionary-');
  afterAll(() => library.cleanup());

  bench('first page', () => {
    library.database.searchTermsPage(dictionaryPage());
  });

  bench('deep page', () => {
    // OFFSET scans degrade linearly. A sharp divergence from the first page is
    // the signal to move paging onto a keyset cursor.
    library.database.searchTermsPage(dictionaryPage({ offset: 1_000 }));
  });

  bench('full-text query', () => {
    library.database.searchTermsPage(dictionaryPage({ query: '咖啡' }));
  });
});

describe('material gallery paging', () => {
  const library = createTestLibrary('aiy-bench-gallery-');
  afterAll(() => library.cleanup());

  bench('first page across every source', () => {
    library.database.listGallery(galleryPage());
  });

  bench('favorites only', () => {
    library.database.listGallery(galleryPage({ favoriteOnly: true }));
  });
});
