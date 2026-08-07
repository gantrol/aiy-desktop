import { z } from 'zod';
import type { ImageRatingDimension } from '@/shared/contracts';

export type GalleryScope = 'ALL' | 'FAVORITE';
export type GalleryRelationship = 'ANY' | 'CREATION' | 'DICTIONARY';
export type GalleryContentType = 'IMAGE' | 'TEXT';
export type GalleryViewMode = 'GRID' | 'LIST';

export interface GalleryPreferences {
  scope: GalleryScope;
  relationship: GalleryRelationship;
  contentTypes: GalleryContentType[];
  unratedDimensions: ImageRatingDimension[];
  viewMode: GalleryViewMode;
}

const storageKey = 'aiy.gallery-preferences.v1';
const dimensions = ['AESTHETIC', 'REALISM'] as const satisfies readonly ImageRatingDimension[];
const contentTypes = ['IMAGE', 'TEXT'] as const satisfies readonly GalleryContentType[];
const scopes = ['ALL', 'FAVORITE'] as const satisfies readonly GalleryScope[];
const relationships = ['ANY', 'CREATION', 'DICTIONARY'] as const satisfies readonly GalleryRelationship[];
const viewModes = ['GRID', 'LIST'] as const satisfies readonly GalleryViewMode[];
const storedGalleryPreferencesSchema = z
  .object({
    scope: z.enum(scopes).optional().catch(undefined),
    relationship: z.enum(relationships).optional().catch(undefined),
    contentTypes: z.array(z.enum(contentTypes)).max(contentTypes.length).optional().catch(undefined),
    unratedDimensions: z.array(z.enum(dimensions)).max(dimensions.length).optional().catch(undefined),
    viewMode: z.enum(viewModes).optional().catch(undefined),
  })
  .passthrough();

export const defaultGalleryPreferences: GalleryPreferences = {
  scope: 'ALL',
  relationship: 'ANY',
  contentTypes: ['IMAGE', 'TEXT'],
  unratedDimensions: [],
  viewMode: 'GRID',
};

function validSubset<T extends string>(value: unknown, allowed: readonly T[]) {
  return Array.isArray(value) ? allowed.filter((candidate) => value.includes(candidate)) : null;
}

function normalize(value: unknown): GalleryPreferences {
  const parsed = storedGalleryPreferencesSchema.safeParse(value);
  const stored = parsed.success ? parsed.data : {};
  const normalizedContentTypes = validSubset(stored.contentTypes, contentTypes);
  return {
    scope: stored.scope ?? defaultGalleryPreferences.scope,
    relationship: stored.relationship ?? defaultGalleryPreferences.relationship,
    contentTypes: normalizedContentTypes?.length ? normalizedContentTypes : defaultGalleryPreferences.contentTypes,
    unratedDimensions: validSubset(stored.unratedDimensions, dimensions) ?? defaultGalleryPreferences.unratedDimensions,
    viewMode: stored.viewMode ?? defaultGalleryPreferences.viewMode,
  };
}

export function loadGalleryPreferences(): GalleryPreferences {
  try {
    const current = window.localStorage.getItem(storageKey);
    return current ? normalize(JSON.parse(current) as unknown) : defaultGalleryPreferences;
  } catch {
    return defaultGalleryPreferences;
  }
}

export function saveGalleryPreferences(preferences: GalleryPreferences) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalize(preferences)));
  } catch {
    // The gallery remains usable when renderer storage is unavailable.
  }
}
