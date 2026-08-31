import { useEffect, useRef, useState } from 'react';
import type {
  ArticleCheckApplyResult,
  ArticleCommentAnchorInput,
  ArticleCommentAnchorUpdateInput,
  ArticleCommentDto,
  ArticleCommentMutationInput,
  ArticleCommentStatus,
  ArticleDto,
} from '@/shared/contracts';
import type { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';

function commentsWithAnchorProjection(
  comments: readonly ArticleCommentDto[],
  updates: readonly ArticleCommentAnchorUpdateInput[],
) {
  const anchors = new Map(updates.map((update) => [update.commentId, update.anchor]));
  return comments.map((comment) => {
    const anchor = anchors.get(comment.id);
    return anchor ? { ...comment, anchor: { ...anchor } } : comment;
  });
}

export function useArticleComments({
  article,
  session,
  notify,
  onSaved,
}: {
  article: ArticleDto;
  session: ReturnType<typeof useArticleEditorSession>;
  notify(message: string): void;
  onSaved(article: ArticleDto): void;
}) {
  const [comments, setComments] = useState(() =>
    commentsWithAnchorProjection(article.comments, session.getArticleCommentAnchorsProjection()),
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(
    () => setComments(commentsWithAnchorProjection(article.comments, session.getArticleCommentAnchorsProjection())),
    [article.comments, session],
  );

  async function mutate(input: ArticleCommentMutationInput, flushDocument = false) {
    if (busyRef.current) return null;
    if (flushDocument && !(await session.flush('manual'))) return null;
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      const persisted = session.capturePersistedArticle();
      const result = await window.desktopApi.articleCommentMutate(input);
      setComments(result.comments);
      onSaved({ ...persisted, comments: result.comments });
      return result.comments;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function create(anchor: ArticleCommentAnchorInput, preview: string, body: string) {
    if (busyRef.current || !(await session.flush('manual'))) return null;
    const persisted = session.capturePersistedArticle();
    const previousIds = new Set(comments.map((comment) => comment.id));
    const next = await mutate({
      operation: 'CREATE',
      articleId: persisted.id,
      expectedRevisionId: persisted.revisionId,
      anchor,
      preview,
      body: body.trim(),
    });
    return next?.find((comment) => !previousIds.has(comment.id))?.id ?? null;
  }

  function mutateExisting(
    operation: Exclude<ArticleCommentMutationInput, { operation: 'CREATE' }>['operation'],
    commentId: string,
    detail: { body?: string; status?: ArticleCommentStatus } = {},
  ) {
    const input =
      operation === 'UPDATE_BODY'
        ? ({ operation, articleId: article.id, commentId, body: detail.body ?? '' } as const)
        : operation === 'ADD_REPLY'
          ? ({ operation, articleId: article.id, commentId, body: detail.body ?? '' } as const)
          : operation === 'SET_STATUS'
            ? ({ operation, articleId: article.id, commentId, status: detail.status ?? 'OPEN' } as const)
            : ({ operation, articleId: article.id, commentId } as const);
    void mutate(input, true);
  }

  function applyCheckResult(result: ArticleCheckApplyResult) {
    const persisted = session.capturePersistedArticle();
    setComments(result.comments);
    onSaved({ ...persisted, comments: result.comments });
  }

  return { comments, busy, create, mutateExisting, applyCheckResult };
}
