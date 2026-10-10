import { useEffect, useState } from 'react';
import type { CreationFormProjection } from '@/renderer/components/creator/creationLibraryProjection';
import {
  creationMatchesAuthor,
  readCreationLibraryAuthorFilter,
} from '@/renderer/components/creator/creationLibraryAuthorFilter';

export function creationFormFilterKey(form: CreationFormProjection): keyof CreationLibraryTypeFilter {
  switch (form.role) {
    case 'ANIMATION':
      return 'animations';
    case 'INSPIRATION':
      return 'inspirations';
    case 'EVALUATION_SUITE':
      return 'evaluations';
    case 'SOCIAL_POST':
      return 'socialPosts';
    case 'ARTICLE':
      return form.entity?.content.editorMode === 'OUTLINE' ? 'outlines' : 'articles';
    case 'VIDEO_DOCUMENT':
      return 'documents';
    default:
      return 'images';
  }
}

export function formMatchesFilter(form: CreationFormProjection, filter: CreationLibraryFilter) {
  // Saved creation inputs now own article forms; keep them reachable through the inspiration filter too.
  return (
    (filter[creationFormFilterKey(form)] ||
      (filter.inspirations &&
        form.role === 'ARTICLE' &&
        Boolean(
          form.entity &&
          ('hasCreationInput' in form.entity ? form.entity.hasCreationInput : form.entity.content.creationInput),
        ))) &&
    creationMatchesAuthor([form], filter.author)
  );
}

export interface CreationLibraryTypeFilter {
  animations: boolean;
  images: boolean;
  documents: boolean;
  articles: boolean;
  outlines: boolean;
  socialPosts: boolean;
  inspirations: boolean;
  evaluations: boolean;
}

export interface CreationLibraryFilter extends CreationLibraryTypeFilter {
  author?: string;
}

export const allCreationLibraryFilters: CreationLibraryFilter = {
  animations: true,
  images: true,
  documents: true,
  articles: true,
  outlines: true,
  socialPosts: true,
  inspirations: true,
  evaluations: true,
};

export const emptyCreationLibraryFilters: CreationLibraryFilter = {
  animations: false,
  images: false,
  documents: false,
  articles: false,
  outlines: false,
  socialPosts: false,
  inspirations: false,
  evaluations: false,
};

const storageKey = 'aiy.creation-library-filter.v5';

export function isAllCreationLibraryFilter(filter: CreationLibraryFilter) {
  return isAllCreationLibraryTypes(filter) && (!filter.author || filter.author === 'ALL');
}

export function isAllCreationLibraryTypes(filter: CreationLibraryTypeFilter) {
  return (
    filter.animations &&
    filter.images &&
    filter.documents &&
    filter.articles &&
    filter.outlines &&
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
    !filter.outlines &&
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
      outlines: typeof record.outlines === 'boolean' ? record.outlines : record.articles,
      socialPosts: record.socialPosts,
      inspirations: record.inspirations,
      evaluations: record.evaluations,
      author: readCreationLibraryAuthorFilter(record.author),
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

export function useCreationLibraryFilter() {
  const [filter, setFilter] = useState<CreationLibraryFilter>(readCreationLibraryFilter);

  useEffect(() => writeCreationLibraryFilter(filter), [filter]);

  return [filter, setFilter] as const;
}
