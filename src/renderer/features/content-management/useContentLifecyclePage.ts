import { useEffect, useRef, useState } from 'react';
import type { ContentLifecycleKind, ContentLifecyclePageDto, ContentLifecycleState } from '@/shared/contracts';

const PAGE_SIZE = 60;

interface Options {
  active: boolean;
  state: ContentLifecycleState;
  kind: ContentLifecycleKind | null;
  containerId: string | null;
  reloadRevision: number;
}

export function useContentLifecyclePage({ active, state, kind, containerId, reloadRevision }: Options) {
  const [page, setPage] = useState<ContentLifecyclePageDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestRevisionRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const requestRevision = ++requestRevisionRef.current;
    setLoading(true);
    setLoadingMore(false);
    setLoadError(false);
    setPage(null);
    void window.desktopApi
      .contentLifecycleList({ state, kind, containerId, limit: PAGE_SIZE })
      .then((nextPage) => {
        if (requestRevisionRef.current === requestRevision) setPage(nextPage);
      })
      .catch(() => {
        if (requestRevisionRef.current === requestRevision) setLoadError(true);
      })
      .finally(() => {
        if (requestRevisionRef.current === requestRevision) setLoading(false);
      });
    return () => {
      requestRevisionRef.current += 1;
    };
  }, [active, containerId, kind, reloadRevision, state]);

  async function loadMore() {
    if (!page?.nextCursor || loadingMore) return;
    const requestRevision = ++requestRevisionRef.current;
    setLoadingMore(true);
    try {
      const nextPage = await window.desktopApi.contentLifecycleList({
        state,
        kind,
        containerId,
        cursor: page.nextCursor,
        limit: PAGE_SIZE,
      });
      if (requestRevisionRef.current !== requestRevision) return;
      setPage((current) =>
        current
          ? {
              items: [...current.items, ...nextPage.items],
              total: nextPage.total,
              nextCursor: nextPage.nextCursor,
            }
          : nextPage,
      );
    } catch {
      if (requestRevisionRef.current === requestRevision) setLoadError(true);
    } finally {
      if (requestRevisionRef.current === requestRevision) setLoadingMore(false);
    }
  }

  return { page, loading, loadingMore, loadError, loadMore };
}
