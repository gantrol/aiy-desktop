import type { PinSource } from '@/shared/contracts/petal-board';
import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
/** Keep source kinds paired with their normal editor; pins do not invent a second editor. */
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
    case 'ARTICLE':
      return { ...initialAppLocation, view: 'creator', creator: { surface: 'article', articleId: source.id } };
    case 'SOCIAL_POST':
      return { ...initialAppLocation, view: 'creator', creator: { surface: 'social-post', postId: source.id } };
    case 'IMAGE':
      // The main process opens the immutable asset in the system image viewer.
      return null;
  }
}
