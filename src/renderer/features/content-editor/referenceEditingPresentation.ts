import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import type { ReferencePresentation } from '@/shared/content-reference-token';
import { presentReferenceDocument } from '@/shared/content-reference-document';

export function referenceEditingPresentation(
  document: BlockDocument,
  title: string,
  presentation: ReferencePresentation | undefined,
  parentLevel: number,
) {
  const projected = presentReferenceDocument(
    { document, title, markdown: '', media: [] },
    presentation ? { ...presentation, display: 'BODY' } : undefined,
    parentLevel,
  );
  const sourceLevels: number[] = [];
  const collect = (node: BlockNode) => {
    if (node.type === 'heading') sourceLevels.push(Number(node.attrs?.level ?? 1));
    node.content?.forEach(collect);
  };
  collect(document.root);
  const shownTitle = Boolean(presentation?.showTitle && title);
  if (shownTitle) sourceLevels.push(1);
  const offset =
    presentation?.headings === 'NEST' && parentLevel && sourceLevels.length
      ? parentLevel + 1 - Math.min(...sourceLevels)
      : 0;
  return {
    document: shownTitle
      ? { ...projected, root: { ...projected.root, content: projected.root.content?.slice(1) } }
      : projected,
    title: shownTitle ? projected.root.content?.[0] : undefined,
    offset,
  };
}

export function unprojectReferenceEdit(document: BlockDocument, offset: number): BlockDocument {
  if (!offset) return document;
  const visit = (node: BlockNode): BlockNode => {
    const level = node.type === 'heading' ? Number(node.attrs?.level ?? 1) - offset : undefined;
    if (level !== undefined && (level < 1 || level > 6)) throw new Error('REFERENCE_HEADING_DEPTH_UNSUPPORTED');
    return {
      ...node,
      ...(level !== undefined ? { attrs: { ...node.attrs, level } } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  };
  return { ...document, root: visit(document.root) };
}
