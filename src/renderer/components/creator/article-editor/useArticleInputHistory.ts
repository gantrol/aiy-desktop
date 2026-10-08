import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArticleInputHistoryPage,
  ArticleInputRecord,
  ArticleInputSummary,
} from '@/shared/contracts/article-input-history';

export function useArticleInputHistory(spaceId: string, articleId: string) {
  const [items, setItems] = useState<ArticleInputSummary[]>([]);
  const [cursor, setCursor] = useState<ArticleInputHistoryPage['nextCursor']>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [record, setRecord] = useState<ArticleInputRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const scope = useRef<object | null>(null);
  const pageRequest = useRef(false);

  useEffect(() => {
    const request = {};
    scope.current = request;
    setItems([]);
    setSelectedId(null);
    setCursor(null);
    setLoading(true);
    setFailed(false);
    void window.desktopApi.articleInputHistory({ spaceId, articleId, cursor: null }).then(
      (page) => {
        if (scope.current !== request) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setSelectedId(page.items[0]?.id ?? null);
        setLoading(false);
      },
      () => {
        if (scope.current !== request) return;
        setFailed(true);
        setLoading(false);
      },
    );
    return () => {
      scope.current = null;
    };
  }, [articleId, spaceId, retry]);

  useEffect(() => {
    let active = true;
    setRecord(null);
    setDetailFailed(false);
    if (selectedId) {
      void window.desktopApi.articleInputRecord({ spaceId, articleId, recordId: selectedId }).then(
        (detail) => {
          if (active) setRecord(detail);
        },
        () => {
          if (active) setDetailFailed(true);
        },
      );
    }
    return () => {
      active = false;
    };
  }, [articleId, selectedId, spaceId, retry]);

  const loadMore = useCallback(async () => {
    if (!cursor || pageRequest.current) return;
    const request = scope.current;
    pageRequest.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await window.desktopApi.articleInputHistory({ spaceId, articleId, cursor });
      if (scope.current !== request) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      if (scope.current === request) setFailed(true);
    } finally {
      pageRequest.current = false;
      if (scope.current === request) setLoading(false);
    }
  }, [articleId, cursor, spaceId]);

  return {
    items,
    cursor,
    selectedId,
    setSelectedId,
    loading,
    failed,
    detailFailed,
    loadMore,
    record: record?.id === selectedId ? record : null,
    reload: () => setRetry((value) => value + 1),
  };
}
