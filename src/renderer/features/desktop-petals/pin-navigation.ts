import type { PinSource } from '@/shared/contracts/petal-board';
import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';

/** Every source returns to its existing work surface, without inventing a second editor. */
export function pinLocation(source: PinSource): AppLocation | null {
  switch (source.kind) {
    case 'ALBUM':
      return { ...initialAppLocation, view: 'creator', creator: { surface: 'album-detail', albumId: source.id } };
    case 'MATERIAL_ALBUM':
      return {
        ...initialAppLocation,
        view: 'gallery',
        gallery: {
          collection: { kind: 'album', albumId: source.id },
          selectedMaterialKey: null,
          requestedMaterialId: null,
        },
      };
    case 'MATERIAL':
      return {
        ...initialAppLocation,
        view: 'gallery',
        gallery: { collection: { kind: 'all' }, selectedMaterialKey: null, requestedMaterialId: source.id },
      };
    case 'ARTICLE':
    case 'INSPIRATION_STASH':
      return { ...initialAppLocation, view: 'creator', creator: { surface: 'article', articleId: source.id } };
    case 'SOCIAL_POST':
      return { ...initialAppLocation, view: 'creator', creator: { surface: 'social-post', postId: source.id } };
    case 'PROMPT_SERIES':
      return {
        ...initialAppLocation,
        view: 'creator',
        creator: { surface: 'existing-creation', seriesId: source.id, assetId: null },
      };
    case 'CREATION_DRAFT':
      return { ...initialAppLocation, view: 'creator', creator: { surface: 'creation-draft', draftId: source.id } };
    case 'VIDEO_DOCUMENT':
      return {
        ...initialAppLocation,
        view: 'documents',
        documents: { collection: { kind: 'all' }, documentId: source.id },
      };
    case 'GIF_DOCUMENT':
      return {
        ...initialAppLocation,
        view: 'creator',
        creator: { surface: 'animation', documentId: source.id, seriesId: null, step: 'edit', title: '' },
      };
    case 'IMAGE':
      // Released key for immutable media assets; the main process opens a validated local file.
      return null;
  }
}
