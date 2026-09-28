import type { ArticleRevisionDto } from '@/shared/contracts';
import type { BlockNode } from '@/shared/contracts/block-document';
import type { ReferenceHistoryResult } from '@/shared/contracts/content-library';
import { contentMarkdownReferences } from '@/shared/content-markdown';
import { contentReferenceToken } from '@/shared/content-reference-token';

/** Restore fixed bindings as a new draft; never mutate the historical revision or current source. */
export function fixedHistoryRevision(
  revision: ArticleRevisionDto,
  history: ReferenceHistoryResult,
): ArticleRevisionDto {
  if (
    history.state !== 'COMPLETE' ||
    revision.articleId !== history.articleId ||
    revision.revisionId !== history.revisionId
  )
    throw new Error('REFERENCE_HISTORY_UNAVAILABLE');
  const fixed = (id: string) => {
    const target = history.bindings[id];
    if (!target) throw new Error('REFERENCE_HISTORY_UNAVAILABLE');
    return target;
  };
  let markdown = revision.content.markdown;
  for (const match of contentMarkdownReferences(markdown).reverse()) {
    // A legacy binding can point to a snapshot without a space qualifier. Keep
    // the saved qualifier, rather than inventing one that its snapshot lacks.
    const token = contentReferenceToken(fixed(match.id), match.presentation, match.spaceId).replace(
      /\n/gu,
      '\n' + match.indent,
    );
    markdown = markdown.slice(0, match.start) + token + markdown.slice(match.end);
  }
  const visit = (node: BlockNode): BlockNode => ({
    ...node,
    ...(node.type === 'contentReference'
      ? {
          attrs: {
            ...node.attrs,
            referenceId: fixed(String(node.attrs?.referenceId)),
          },
        }
      : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return {
    ...revision,
    content: {
      ...revision.content,
      markdown,
      ...(revision.content.document
        ? { document: { ...revision.content.document, root: visit(revision.content.document.root) } }
        : {}),
    },
  };
}
