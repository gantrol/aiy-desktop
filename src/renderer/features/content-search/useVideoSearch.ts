import { useEffect, useState } from 'react';
import type { VideoSearchResult, VideoSearchItem } from '@/shared/contracts/video-search';
import type { SearchListState } from '@/renderer/features/content-search/ContentSearchResults';

const empty: VideoSearchResult = {
  scope: 'CURRENT_SAVED_DOCUMENTS',
  snapshot: '',
  reset: false,
  items: [],
  nextOffset: null,
  coverage: { total: 0, ready: 0, pending: 0, unavailable: 0, limited: 0 },
  indexedFrames: 0,
  processedMs: 0,
  totalMs: 0,
  relevance: 'EMPTY',
};

export function useVideoSearch(query: string, mode: 'SEMANTIC' | 'HYBRID', enabled: boolean) {
  const [paused, setPaused] = useState(false);
  const [request, setRequest] = useState({ revision: 0, offset: 0, snapshot: '', retry: false });
  const context = JSON.stringify([query, mode]);
  const key = JSON.stringify([context, request.revision]);
  const [data, setData] = useState<{ key: string; result: VideoSearchResult } | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: string } | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const usable = Boolean(query.trim());
  useEffect(() => {
    if (!enabled || !usable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestId = '';
    let visibilityCancelled = false;
    let first = true;
    let retry = request.retry;
    let offset = request.snapshot ? request.offset : 0;
    let snapshot = request.snapshot;
    const cancel = () => {
      if (requestId) void window.desktopApi.imageSearch.cancel(requestId).catch(() => undefined);
    };
    const run = async () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(() => void run(), 500);
        return;
      }
      requestId = crypto.randomUUID();
      setBusyKey(key);
      setFailure(null);
      try {
        const response = await window.desktopApi.imageSearch.lookupVideo({
          requestId,
          query,
          mode,
          offset,
          snapshot,
          advanceIndex: !first && !paused,
          retryUnavailable: retry,
        });
        requestId = '';
        if (cancelled) return;
        if ('error' in response) {
          if (response.error === 'CANCELLED' && visibilityCancelled) {
            visibilityCancelled = false;
            timer = setTimeout(() => void run(), 500);
            return;
          }
          throw new Error(response.error);
        }
        const page = response.result;
        setData((previous) => ({
          key,
          result: {
            ...page,
            items:
              offset && !page.reset && previous?.key === key && previous.result.snapshot === page.snapshot
                ? [
                    ...previous.result.items,
                    ...page.items.filter((item) => !previous.result.items.some((existing) => existing.id === item.id)),
                  ]
                : page.items,
          },
        }));
        if (page.reset) offset = 0;
        snapshot = page.snapshot;
        if (!first) retry = false;
        first = false;
        setBusyKey('');
        if (!paused && (page.coverage.pending || retry)) timer = setTimeout(() => void run(), 100);
      } catch (error) {
        if (!cancelled) {
          setFailure({ key, error: error instanceof Error ? error.message : 'UNAVAILABLE' });
          setBusyKey('');
        }
      }
    };
    const visibility = () => {
      if (document.hidden) {
        visibilityCancelled = Boolean(requestId);
        cancel();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    timer = setTimeout(() => void run(), 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancel();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [query, mode, key, enabled, usable, paused, request]);

  const result = !usable ? empty : data?.key === key ? data.result : null;
  const error = failure?.key === key ? failure.error : '';
  const busy = enabled && usable && (busyKey === key || (!result && !error));
  const state: SearchListState<VideoSearchItem> = {
    key,
    result,
    error,
    busy: busy && !result,
    loadingMore: busy && request.offset > 0,
    paused,
    hasMore: result?.nextOffset != null,
    pause: () => setPaused((value) => !value),
    refresh: () => setRequest((current) => ({ revision: current.revision + 1, offset: 0, snapshot: '', retry: true })),
    more: () => {
      if (!busy && result?.nextOffset != null)
        setRequest((current) =>
          current.offset === result.nextOffset && current.snapshot === result.snapshot
            ? current
            : { ...current, offset: result.nextOffset!, snapshot: result.snapshot, retry: false },
        );
    },
  };
  return { ...state, videoResult: result };
}
