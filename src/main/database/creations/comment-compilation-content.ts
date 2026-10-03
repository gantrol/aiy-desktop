import type { ArticleDto } from '@/shared/contracts';
import { plainTextBlockDocument } from '@/shared/block-document-codecs';
import { captureBlockDocument, type BlockNode } from '@/shared/contracts/block-document';
import type { CommentCompilationInput, CommentCompilationOrigin } from '@/shared/contracts/comment-compilation';

/** Copies plain-text comments, not executable Markdown, HTML or live references. */
export function commentCompilationContent(
  source: ArticleDto,
  input: CommentCompilationInput,
  authorNames: ReadonlyMap<string, string>,
) {
  const byId = new Map(source.comments.map((comment) => [comment.id, comment]));
  const origin: CommentCompilationOrigin = {
    sourceArticleId: source.id,
    sourceRevisionId: source.revisionId,
    compiledRevisionNo: 1,
    comments: [],
  };
  const sections = input.comments.flatMap((selected, index): BlockNode[] => {
    const comment = byId.get(selected.id)!;
    const authorName = comment.authorId ? (authorNames.get(comment.authorId) ?? null) : null;
    const identity = comment.modelAuthor
      ? [authorName, comment.modelAuthor.providerKey, comment.modelAuthor.modelId].filter(Boolean).join(' · ')
      : authorName;
    const heading = [String(index + 1), identity].filter(Boolean).join(' · ');
    const body = plainTextBlockDocument(comment.body).root.content!;
    const quote =
      input.includeQuotes && comment.anchor.exactQuote
        ? plainTextBlockDocument(comment.anchor.exactQuote).root.content!
        : [];
    const header: BlockNode = {
      type: input.format === 'OUTLINE' ? 'paragraph' : 'heading',
      ...(input.format === 'MANUSCRIPT' ? { attrs: { level: 2 } } : {}),
      content: [{ type: 'text', text: heading }],
    };
    origin.comments.push({
      commentId: comment.id,
      createdRevisionId: comment.createdRevisionId,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      sourceElementId: comment.anchor.startElementId,
      bodyBlockIds: body.map((node) => String(node.attrs!.blockId)),
      ...(quote.length ? { quoteBlockIds: quote.map((node) => String(node.attrs!.blockId)) } : {}),
      authorId: comment.authorId,
      authorName,
      modelAuthor: comment.modelAuthor,
    });
    const content: BlockNode[] = [header, ...(quote.length ? [{ type: 'blockquote', content: quote }] : []), ...body];
    return input.format === 'OUTLINE' ? [{ type: 'listItem', content }] : content;
  });
  const document = captureBlockDocument({
    type: 'doc',
    content: input.format === 'OUTLINE' ? [{ type: 'bulletList', content: sections }] : sections,
  });
  return { document, origin };
}
