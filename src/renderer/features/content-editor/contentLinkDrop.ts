import type { ContentLinkInput, ContentLinkResult } from '@/shared/contracts/content-links';
import type { ReferenceTarget } from '@/shared/contracts/content-source';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import { referenceDragType } from '@/renderer/lib/itemReferenceDrag';
import { itemDragIntent } from '@/renderer/components/albums/itemDrag';
import { ALBUM_DRAG_TYPE } from '@/renderer/components/albums/albumDrag';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';

export function isContentLinkDrag(
  event: Pick<DragEvent, 'dataTransfer' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>,
) {
  return (
    itemDragIntent(event) === 'MOVE' &&
    Boolean(event.dataTransfer?.types.includes(referenceDragType)) &&
    Boolean(event.dataTransfer?.types.includes(ALBUM_DRAG_TYPE))
  );
}

async function linkTarget(target: ReferenceTarget): Promise<ContentLinkInput['target']> {
  const { source, blockId } = target;
  if (source.kind === 'ALBUM') return { kind: 'ALBUM', id: source.id };
  if (source.kind === 'ARTICLE') return { kind: 'ARTICLE', id: source.id, ...(blockId ? { blockId } : {}) };
  if (source.kind === 'CREATION_ITEM') {
    const item = await window.desktopApi?.creationItemGet({ creationItemId: source.id });
    if (!item) throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
    const articles = item.forms.filter((form) => form.entity.kind === 'ARTICLE');
    const primary = articles.find((form) => form.id === item.primaryFormId);
    const article = primary ?? (articles.length === 1 ? articles[0] : null);
    if (article) return { kind: 'ARTICLE', id: article.entity.id };
  }
  throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
}

export async function resolveDroppedContentLinks(
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>,
  spaceId: string,
  assertCurrent: () => void,
) {
  assertCurrent();
  const source = await payload.prepare?.();
  if (payload.prepare && !source) throw new Error('REFERENCE_SAVE_FAILED');
  const links: ContentLinkResult[] = [];
  for (const target of payload.targets) {
    assertCurrent();
    if (source && (source.kind !== target.source.kind || source.id !== target.source.id))
      throw new Error('REFERENCE_TARGET_CHANGED');
    const selected = await linkTarget(target);
    assertCurrent();
    const link = await contentLibraryApi().linkResolve({ spaceId, target: selected });
    assertCurrent();
    if (link.spaceId !== spaceId) throw new Error('REFERENCE_TARGET_CHANGED');
    links.push(link);
  }
  return links;
}
