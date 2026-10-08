import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoDocumentDto, VideoDocumentSummaryDto } from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  active: boolean;
  refreshKey?: number | string;
  query: string;
  albumId: string | null;
  includeDescendants?: boolean;
  unfiledOnly: boolean;
  notify(message: string): void;
}

export function useVideoDocumentList({
  active,
  refreshKey = 0,
  query,
  albumId,
  includeDescendants = true,
  unfiledOnly,
  notify,
}: Options) {
  const [items, setItems] = useState<VideoDocumentSummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(active);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestGeneration = useRef(0);
  const key = JSON.stringify([query, albumId, includeDescendants, unfiledOnly]);
  const loaded = useRef<{ key: string; refreshKey: number | string; revision: number } | null>(null);
  const requestedKey = useRef(key);
  const reportError = useStableCallback(notify);

  useEffect(() => {
    const request = ++requestGeneration.current;
    setLoadingMore(false);
    if (!active) {
      setLoading(false);
      return undefined;
    }
    const cancel = () => {
      requestGeneration.current += 1;
    };
    if (
      loaded.current?.key === key &&
      loaded.current.refreshKey === refreshKey &&
      loaded.current.revision === revision
    ) {
      setLoading(false);
      return cancel;
    }
    loaded.current = null;
    let current = true;
    if (requestedKey.current !== key) {
      requestedKey.current = key;
      setItems([]);
      setTotal(0);
      setNextCursor(null);
    }
    setLoading(true);
    const timeout = window.setTimeout(() => {
      void window.desktopApi
        .videoDocumentsList({ query, albumId, includeDescendants, unfiledOnly, cursor: null, limit: 40 })
        .then((page) => {
          if (!current || request !== requestGeneration.current) return;
          loaded.current = { key, refreshKey, revision };
          setItems(page.items);
          setTotal(page.total);
          setNextCursor(page.nextCursor);
          setLoading(false);
        })
        .catch((reason) => {
          if (!current || request !== requestGeneration.current) return;
          setLoading(false);
          reportError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 180);
    return () => {
      current = false;
      cancel();
      window.clearTimeout(timeout);
    };
  }, [active, albumId, includeDescendants, key, query, refreshKey, reportError, revision, unfiledOnly]);

  const loadMore = useCallback(async () => {
    if (!active || loading || !nextCursor || loadingMore) return;
    const request = requestGeneration.current;
    const cursor = nextCursor;
    setLoadingMore(true);
    try {
      const page = await window.desktopApi.videoDocumentsList({
        query,
        albumId,
        includeDescendants,
        unfiledOnly,
        cursor,
        limit: 40,
      });
      if (request !== requestGeneration.current) return;
      setTotal(page.total);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (request !== requestGeneration.current) return;
      reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === requestGeneration.current) setLoadingMore(false);
    }
  }, [active, albumId, includeDescendants, loading, loadingMore, nextCursor, reportError, query, unfiledOnly]);

  const updateSummary = useCallback((updated: VideoDocumentDto) => {
    setItems((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
  }, []);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  return {
    items,
    total,
    loading,
    loadingMore,
    hasMore: Boolean(nextCursor),
    loadMore,
    refresh,
    updateSummary,
  };
}
