import { useEffect, useState } from 'react';
import type { ContentLookupApi, ContentLookupInput, ContentLookupResult } from '@/shared/contracts/content-search';

/** Indexing advances only while this search is active, visible and outside IME composition. */
export function useContentLookup(
  api: ContentLookupApi,
  query: string,
  type: ContentLookupInput['type'],
  enabled = true,
) {
  const [request, setRequest] = useState({ query, type, offset: 0, snapshot: '', revision: 0, retry: false });
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<{ key: string; result: ContentLookupResult; offset: number } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const matching = request.query === query && request.type === type;
  const offset = matching ? request.offset : 0;
  const key = JSON.stringify([query, type, offset, request.revision]);
  useEffect(() => {
    if (!enabled) return;
    if (!matching) {
      setRequest((current) => ({ query, type, offset: 0, snapshot: '', revision: current.revision + 1, retry: false }));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = matching && request.retry;
    setError(null);
    setPendingKey(key);
    const run = async () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(() => void run(), 500);
        return;
      }
      try {
        const result = await api.lookup({
          query,
          type,
          offset,
          snapshot: matching ? request.snapshot : undefined,
          retryUnavailable: retry,
          advanceIndex: !paused,
        });
        retry = false;
        if (cancelled) return;
        setData({ key, result, offset: result.reset ? 0 : offset });
        setPendingKey(null);
        if (result.coverage.pending && !paused) timer = setTimeout(() => void run(), 80);
      } catch (reason) {
        if (!cancelled) {
          setError({ key, message: String(reason) });
          setPendingKey(null);
        }
      }
    };
    timer = setTimeout(() => void run(), 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, key, query, type, offset, matching, request.retry, request.snapshot, paused, enabled]);
  const result = data?.key === key ? data.result : null;
  const pageOffset = result?.reset ? 0 : offset;
  const changePage = (next: number) => {
    if (!result) return;
    setRequest((current) => ({
      query,
      type,
      offset: next,
      snapshot: result.snapshot,
      revision: current.revision + 1,
      retry: false,
    }));
  };
  return {
    key,
    result,
    error: error?.key === key ? error.message : '',
    busy: enabled && (pendingKey === key || (!result && error?.key !== key)),
    paused,
    page: Math.floor(pageOffset / 30) + 1,
    hasPrevious: pageOffset > 0,
    canPage: result
      ? pageOffset > 0 || result.nextOffset !== null
      : Boolean(data && (data.offset > 0 || data.result.nextOffset !== null)),
    pause: () => setPaused((value) => !value),
    refresh: () =>
      setRequest((current) => ({ query, type, offset: 0, snapshot: '', revision: current.revision + 1, retry: true })),
    more: () => {
      if (result?.nextOffset != null) changePage(result.nextOffset);
    },
    previous: () => changePage(Math.max(0, pageOffset - 30)),
  };
}
