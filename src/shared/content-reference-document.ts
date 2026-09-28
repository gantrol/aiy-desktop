import type { ContentReference } from '@/shared/contracts/content-library';
import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import type { ReferencePresentation } from '@/shared/content-reference-token';
import { copyLinkedBlockDocument } from '@/shared/block-anchor-copy';
import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { contentLinkUrl } from '@/shared/contracts/content-links';
import { referenceLinkUrl, type ReferenceLinkSource } from '@/shared/content-reference-link';

/** A pure occurrence projection. Neither saved source blocks nor snapshot attributes are mutated. */
export function presentReferenceDocument(
  reference: Pick<ContentReference, 'document' | 'markdown' | 'media' | 'title'> & ReferenceLinkSource,
  presentation?: ReferencePresentation,
  parentLevel = 0,
): BlockDocument {
  if (presentation?.display === 'LINK') {
    const href = referenceLinkUrl(reference);
    if (!href) throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
    return {
      schemaVersion: 1,
      format: 'PROSEMIRROR_JSON',
      root: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: reference.title || href, marks: [{ type: 'link', attrs: { href } }] }],
          },
        ],
      },
    };
  }
  const document = reference.document ?? markdownBlockDocument(reference.markdown, reference.media);
  const children = [...(document.root.content ?? [])];
  if (presentation?.showTitle && reference.title)
    children.unshift({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: reference.title }] });
  const levels: number[] = [];
  const collect = (node: BlockNode) => {
    if (node.type === 'heading') levels.push(Number(node.attrs?.level ?? 1));
    node.content?.forEach(collect);
  };
  children.forEach(collect);
  const offset =
    presentation?.headings === 'NEST' && parentLevel && levels.length ? parentLevel + 1 - Math.min(...levels) : 0;
  if (levels.some((level) => level + offset > 6 || level + offset < 1))
    throw new Error('REFERENCE_HEADING_DEPTH_UNSUPPORTED');
  const visit = (node: BlockNode): BlockNode => ({
    ...node,
    ...(node.type === 'heading' ? { attrs: { ...node.attrs, level: Number(node.attrs?.level ?? 1) + offset } } : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  const content = children.map(visit);
  return {
    ...document,
    root: { type: 'doc', content: presentation?.display === 'QUOTE' ? [{ type: 'blockquote', content }] : content },
  };
}

/** New writable IDs, internal links rebound, out-of-range local links qualified with their real source. */
export function referenceEditableDocument(
  reference: ContentReference,
  presentation?: ReferencePresentation,
  parentLevel = 0,
) {
  const document = presentReferenceDocument(reference, presentation, parentLevel);
  const ids = new Set<string>();
  const collect = (node: BlockNode) => {
    if (typeof node.attrs?.blockId === 'string') ids.add(node.attrs.blockId);
    node.content?.forEach(collect);
  };
  collect(document.root);
  const visit = (node: BlockNode): BlockNode => ({
    ...node,
    ...(node.marks
      ? {
          marks: node.marks.map((mark) => {
            const href = mark.attrs?.href;
            if (mark.type !== 'link' || typeof href !== 'string' || !href.startsWith('#aiy-block:')) return mark;
            const blockId = decodeURIComponent(href.slice('#aiy-block:'.length));
            if (ids.has(blockId)) return mark;
            if (!reference.spaceId || reference.source.kind !== 'ARTICLE')
              throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
            return {
              ...mark,
              attrs: {
                ...mark.attrs,
                href: contentLinkUrl({
                  spaceId: reference.spaceId,
                  target: { kind: 'ARTICLE', id: reference.source.id, blockId },
                }),
              },
            };
          }),
        }
      : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return copyLinkedBlockDocument(visit(document.root));
}
