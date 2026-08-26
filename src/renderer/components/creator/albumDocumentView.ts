import {
  isAllCreationLibraryFilter,
  type CreationLibraryFilter,
} from '@/renderer/components/creator/creationLibraryFilter';
import type { GalleryRelationship, GalleryScope } from '@/renderer/components/gallery/galleryPreferences';

export function shouldShowDocumentView({
  filter,
  loading,
  error,
  query,
  scope,
  relationship,
  unratedDimensionCount,
  materialCount,
  documentLoading,
  documentTotal,
}: {
  filter: CreationLibraryFilter;
  loading: boolean;
  error: string;
  query: string;
  scope: GalleryScope;
  relationship: GalleryRelationship;
  unratedDimensionCount: number;
  materialCount: number;
  documentLoading: boolean;
  documentTotal: number;
}) {
  return (
    (!filter.images && filter.documents) ||
    (isAllCreationLibraryFilter(filter) &&
      !loading &&
      !error &&
      !query &&
      scope === 'ALL' &&
      relationship === 'ANY' &&
      unratedDimensionCount === 0 &&
      materialCount === 0 &&
      (documentLoading || documentTotal > 0))
  );
}
