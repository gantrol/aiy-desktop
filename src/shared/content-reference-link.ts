import type { ContentReference } from '@/shared/contracts/content-library';
import { contentLinkUrl } from '@/shared/contracts/content-links';

export type ReferenceLinkSource = Partial<Pick<ContentReference, 'source' | 'spaceId' | 'selector'>>;

/** Link presentation retains the captured scope while navigating to its current source. */
export function referenceLinkUrl(reference: ReferenceLinkSource): string | undefined {
  const { source, spaceId, selector } = reference;
  if (!spaceId || !source || !['ARTICLE', 'ALBUM', 'SOCIAL_POST', 'INSPIRATION_STASH'].includes(source.kind)) return;
  return contentLinkUrl({
    spaceId,
    target: {
      kind: source.kind === 'ALBUM' ? 'ALBUM' : 'ARTICLE',
      id: source.id,
      ...(selector?.kind === 'BLOCK' ? { blockId: selector.blockId } : {}),
    },
  });
}
