import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
import type { ContentSource } from '@/shared/contracts/content-source';

export function contentSearchLocation(source: ContentSource): AppLocation {
  if (source.kind === 'VIDEO_DOCUMENT')
    return {
      ...initialAppLocation,
      view: 'documents',
      documents: { collection: { kind: 'all' }, documentId: source.id },
    };
  return {
    ...initialAppLocation,
    creator:
      source.kind === 'SOCIAL_POST'
        ? { surface: 'social-post', postId: source.id }
        : source.kind === 'INSPIRATION_STASH'
          ? { surface: 'inspiration-stash', stashId: source.id }
          : { surface: 'article', articleId: source.id },
  };
}
