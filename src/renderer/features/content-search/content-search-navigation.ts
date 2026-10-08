import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
import type { ContentSource } from '@/shared/contracts/content-source';

export function contentSearchLocation(source: ContentSource, query = ''): AppLocation {
  const contentSearchTarget = query.trim() ? { source, query } : undefined;
  if (source.kind === 'VIDEO_DOCUMENT')
    return {
      ...initialAppLocation,
      contentSearchTarget,
      view: 'documents',
      documents: { collection: { kind: 'all' }, documentId: source.id },
    };
  return {
    ...initialAppLocation,
    contentSearchTarget,
    creator:
      source.kind === 'SOCIAL_POST'
        ? { surface: 'social-post', postId: source.id }
        : source.kind === 'INSPIRATION_STASH'
          ? { surface: 'inspiration-stash', stashId: source.id }
          : { surface: 'article', articleId: source.id },
  };
}
