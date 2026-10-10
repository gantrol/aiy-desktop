import { useEffect, useState } from 'react';
import type { ArticleDto, ArticleListItem } from '@/shared/contracts';
import { isArticleLoaded } from '@/shared/article-summary';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

const pending = new Map<string, Promise<ArticleDto>>();

export function loadArticleDetails(spaceId: string, article: ArticleListItem): Promise<ArticleDto> {
  if (isArticleLoaded(article)) return Promise.resolve(article);
  const key = `${spaceId}:${article.id}:${article.revisionId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = window.desktopApi.articleOpen({ spaceId, articleId: article.id }).then((result) => result.article);
  pending.set(key, request);
  void request
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    })
    .catch(() => undefined);
  return request;
}

export function useArticleDetails(
  spaceId: string,
  article: ArticleListItem | null,
  active: boolean,
  notify: (message: string) => void,
) {
  const [loaded, setLoaded] = useState<{ spaceId: string; article: ArticleDto } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${spaceId}:${article?.id}:${article?.revisionId}`;
  const report = useStableCallback(notify);
  const retained = loaded?.spaceId === spaceId && loaded.article.id === article?.id ? loaded.article : null;
  const current =
    article && isArticleLoaded(article)
      ? article
      : retained && retained.revisionNo >= article!.revisionNo
        ? retained
        : null;
  useEffect(() => {
    if (!active || !article || current) return;
    let cancelled = false;
    setFailure(null);
    void loadArticleDetails(spaceId, article)
      .then((result) => {
        if (!cancelled) setLoaded({ spaceId, article: result });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setFailure({ key, message });
          report(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, article, current, spaceId, report, key, attempt]);
  return {
    article: current ?? retained,
    error: failure?.key === key ? failure.message : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
