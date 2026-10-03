import type { ArticleDto } from '@/shared/contracts';
import { commentCompilationSelection } from '@/shared/contracts/comment-compilation';
import type {
  CommentCompilationDraft,
  CommentCompilationState,
} from '@/renderer/features/comment-compilation/commentCompilationState';

/** A refresh changes source expectations, not the user's title, order or output choices. */
export function prepareCompilationDraft(
  article: ArticleDto,
  spaceId: string,
  previous: CommentCompilationState,
  defaultTitle: string,
): CommentCompilationDraft {
  const ids = previous.selectedIds;
  const comments = new Map(article.comments.map((comment) => [comment.id, comment]));
  const selected = ids.map((id) => {
    const comment = comments.get(id);
    if (!comment) throw new Error('COMMENT_COMPILATION_COMMENTS_CHANGED');
    return commentCompilationSelection(comment);
  });
  return {
    spaceId,
    sourceArticleId: article.id,
    expectedRevisionId: article.revisionId,
    title: previous.options?.title ?? defaultTitle.slice(0, 200),
    format: previous.options?.format ?? 'MANUSCRIPT',
    includeQuotes: previous.options?.includeQuotes ?? true,
    comments: selected,
  };
}
