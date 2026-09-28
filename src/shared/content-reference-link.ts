import type { ContentReference } from '@/shared/contracts/content-library';
import { contentLinkUrl } from '@/shared/contracts/content-links';

export type ReferenceLinkSource = Partial<Pick<ContentReference, 'source' | 'spaceId' | 'selector'>>;

/** Link presentation retains the captured scope while navigating to its current source. */
export function referenceLinkUrl(reference: ReferenceLinkSource): string | undefined {
  const { source, spaceId, selector } = reference;
  if (!spaceId || !source || (source.kind !== 'ARTICLE' && source.kind !== 'ALBUM')) return;
  return contentLinkUrl({
    spaceId,
    target: {
      kind: source.kind,
      id: source.id,
      ...(selector?.kind === 'BLOCK' ? { blockId: selector.blockId } : {}),
    },
  });
}
