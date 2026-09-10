import type { CreationFormDto } from '@/shared/contracts';

export function formMatchesFilter(form: Pick<CreationFormDto, 'role'>, filter: CreationLibraryFilter) {
  switch (form.role) {
    case 'ANIMATION':
      return filter.animations;
    case 'INSPIRATION':
      return filter.inspirations;
    case 'EVALUATION_SUITE':
      return filter.evaluations;
    case 'SOCIAL_POST':
      return filter.socialPosts;
    case 'ARTICLE':
      return filter.articles;
    case 'VIDEO_DOCUMENT':
      return filter.documents;
    default:
      return filter.images;
  }
}

export interface CreationLibraryFilter {
  animations: boolean;
  images: boolean;
  documents: boolean;
  articles: boolean;
  socialPosts: boolean;
  inspirations: boolean;
  evaluations: boolean;
}

export const allCreationLibraryFilters: CreationLibraryFilter = {
  animations: true,
  images: true,
  documents: true,
  articles: true,
  socialPosts: true,
  inspirations: true,
  evaluations: true,
};

const storageKey = 'aiy.creation-library-filter.v5';

export function isAllCreationLibraryFilter(filter: CreationLibraryFilter) {
  return (
    filter.animations &&
    filter.images &&
    filter.documents &&
    filter.articles &&
    filter.socialPosts &&
    filter.inspirations &&
    filter.evaluations
  );
}

export function isOnlyInspirationLibraryFilter(filter: CreationLibraryFilter) {
  return (
    !filter.animations &&
    filter.inspirations &&
    !filter.images &&
    !filter.documents &&
    !filter.articles &&
    !filter.socialPosts &&
    !filter.evaluations
  );
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
      typeof record.inspirations !== 'boolean' ||
      typeof record.evaluations !== 'boolean'
    ) {
      return fallback;
    }
    return {
      animations: typeof record.animations === 'boolean' ? record.animations : true,
      images: record.images,
      documents: record.documents,
      articles: record.articles,
      socialPosts: record.socialPosts,
      inspirations: record.inspirations,
      evaluations: record.evaluations,
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

export function useCreationLibraryFilter(documentWorkspaceActive: boolean) {
  const [filter, setFilter] = useState<CreationLibraryFilter>(readCreationLibraryFilter);

  useEffect(() => writeCreationLibraryFilter(filter), [filter]);

  useEffect(() => {
    if (documentWorkspaceActive && !filter.documents) {
      setFilter((current) => ({ ...current, documents: true }));
    }
  }, [documentWorkspaceActive, filter.documents]);

  return [filter, setFilter] as const;
}
import { useEffect, useState } from 'react';
