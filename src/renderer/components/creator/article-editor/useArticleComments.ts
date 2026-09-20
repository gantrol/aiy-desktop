import { useRef, useState } from 'react';
import type {
  ArticleCommentAnchorInput,
  ArticleCommentMutationInput,
  ArticleCommentStatus,
  ArticleDto,
} from '@/shared/contracts';
import {
  useArticleEditorSessionSelector,
  type useArticleEditorSession,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';

export function useArticleComments({
  article,
  session,
  notify,
}: {
  article: ArticleDto;
  session: ReturnType<typeof useArticleEditorSession>;
  notify(message: string): void;
}) {
  const comments = useArticleEditorSessionSelector((state) => state.draft.comments);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function mutate(input: (article: ArticleDto) => ArticleCommentMutationInput) {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await session.mutateComments((persisted) =>
        window.desktopApi.articleCommentMutate(input(persisted)),
      );
      return result?.comments ?? null;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function create(anchor: ArticleCommentAnchorInput, preview: string, body: string) {
    if (busyRef.current) return null;
    const previousIds = new Set(comments.map((comment) => comment.id));
    const next = await mutate((persisted) => ({
      operation: 'CREATE',
      articleId: persisted.id,
      expectedRevisionId: persisted.revisionId,
      anchor,
      preview,
      body: body.trim(),
    }));
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
    return mutate(() => input).then((result) => result !== null);
  }

  return { comments, busy, create, mutateExisting };
}
