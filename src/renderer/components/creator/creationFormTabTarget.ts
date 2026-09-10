import type { CreatorOpenTabTarget } from '@/renderer/components/app/app-navigation';
import type { CreationFormProjection } from '@/renderer/components/creator/creationLibraryProjection';

export function creationFormTabTarget(
  form: CreationFormProjection,
  albumId: string | null,
): CreatorOpenTabTarget | null {
  switch (form.role) {
    case 'ANIMATION':
      return {
        view: 'creator',
        location: {
          surface: 'animation',
          documentId: form.entityRef.id,
          seriesId: form.entity?.seriesId ?? null,
          step: 'edit',
          title: form.entity?.title ?? '',
          ...form.entity?.workspace,
        },
      };
    case 'INSPIRATION':
      return { view: 'creator', location: { surface: 'inspiration-stash', stashId: form.entityRef.id } };
    case 'IMAGE_BREAKDOWN':
      return { view: 'creator', location: { surface: 'image-breakdown', breakdownId: form.entityRef.id } };
    case 'EVALUATION_SUITE':
      return { view: 'creator', location: { surface: 'evaluation-suite', suiteId: form.entityRef.id } };
    case 'IMAGE_CREATION':
      return {
        view: 'creator',
        location: {
          surface: 'existing-creation',
          seriesId: form.session?.primarySeries.id ?? form.entityRef.id,
          assetId: null,
        },
      };
    case 'SOCIAL_POST':
      return { view: 'creator', location: { surface: 'social-post', postId: form.entityRef.id } };
    case 'ARTICLE':
      return { view: 'creator', location: { surface: 'article', articleId: form.entityRef.id } };
    case 'VIDEO_DOCUMENT':
      return {
        view: 'documents',
        location: {
          collection: albumId ? { kind: 'album', albumId } : { kind: 'unfiled' },
          documentId: form.entityRef.id,
        },
      };
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE':
      return null;
  }
}
