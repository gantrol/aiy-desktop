export interface CreationLibraryFilter {
  images: boolean;
  documents: boolean;
  articles: boolean;
  socialPosts: boolean;
  inspirations: boolean;
}

export const allCreationLibraryFilters: CreationLibraryFilter = {
  images: true,
  documents: true,
  articles: true,
  socialPosts: true,
  inspirations: true,
};

const storageKey = 'aiy.creation-library-filter.v4';

export function isAllCreationLibraryFilter(filter: CreationLibraryFilter) {
  return filter.images && filter.documents && filter.articles && filter.socialPosts && filter.inspirations;
}

export function isOnlyInspirationLibraryFilter(filter: CreationLibraryFilter) {
  return filter.inspirations && !filter.images && !filter.documents && !filter.articles && !filter.socialPosts;
}

export function readCreationLibraryFilter(): CreationLibraryFilter {
  const fallback = { ...allCreationLibraryFilters };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const record = value as Record<string, unknown>;
    if (
      typeof record.images !== 'boolean' ||
      typeof record.documents !== 'boolean' ||
      typeof record.articles !== 'boolean' ||
      typeof record.socialPosts !== 'boolean' ||
      typeof record.inspirations !== 'boolean'
    ) {
      return fallback;
    }
    return {
      images: record.images,
      documents: record.documents,
      articles: record.articles,
      socialPosts: record.socialPosts,
      inspirations: record.inspirations,
    };
  } catch {
    return fallback;
  }
}

export function writeCreationLibraryFilter(filter: CreationLibraryFilter) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(filter));
  } catch {
    // Filtering still works for this session when browser persistence is unavailable.
  }
}
