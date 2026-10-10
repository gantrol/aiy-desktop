import { useEffect, useState } from 'react';
import type { ContentLookupApi, ContentLookupInput, ContentLookupResult } from '@/shared/contracts/content-search';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';

interface LookupData {
  key: string;
  requestKey: string;
  result: ContentLookupResult;
  resetRevision: number;
}

function receivePage(
  previous: LookupData | null,
  page: ContentLookupResult,
  key: string,
  requestKey: string,
  offset: number,
): LookupData {
  const current = previous?.key === key ? previous : null;
  const append = offset > 0 && !page.reset && current?.result.snapshot === page.snapshot;
  const items = new Map(
    (append ? current.result.items : []).map((item) => [contentSearchSourceKey(item.source), item]),
  );
  for (const item of page.items) items.set(contentSearchSourceKey(item.source), item);
  return {
    key,
    requestKey,
    result: {
      ...page,
      items: [...items.values()],
      reset: page.reset || (current?.requestKey === requestKey && current.result.reset),
    },
    resetRevision: (current?.resetRevision ?? 0) + (page.reset && current?.result.snapshot !== page.snapshot ? 1 : 0),
  };
}

/** Indexing advances only while this search is active, visible and outside IME composition. */
export function useContentLookup(
  api: ContentLookupApi,
  query: string,
  type: ContentLookupInput['type'],
  enabled = true,
  pollDelay = 80,
  context = '',
) {
  const [request, setRequest] = useState({
    query,
    type,
    context,
    offset: 0,
    snapshot: '',
    revision: 0,
    attempt: 0,
    retry: false,
  });
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<LookupData | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const matching = request.query === query && request.type === type && request.context === context;
  const offset = matching ? request.offset : 0;
  const key = JSON.stringify([query, type, context, request.revision]);
  const requestKey = JSON.stringify([key, offset, request.attempt]);
  useEffect(() => {
    if (!enabled) return;
    if (!matching) {
      setRequest((current) => ({
        query,
        type,
        context,
        offset: 0,
        snapshot: '',
        revision: current.revision + 1,
        attempt: 0,
        retry: false,
      }));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = matching && request.retry;
    let pageOffset = offset;
    let snapshot = request.snapshot;
    setError(null);
    setPendingKey(requestKey);
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
          offset: pageOffset,
          snapshot,
          retryUnavailable: retry,
          advanceIndex: !paused,
        });
        retry = false;
        if (cancelled) return;
        const receivedOffset = pageOffset;
        setData((current) => receivePage(current, result, key, requestKey, receivedOffset));
        if (result.reset) pageOffset = 0;
        snapshot = result.snapshot;
        setPendingKey(null);
        if (result.coverage.pending && !paused) timer = setTimeout(() => void run(), pollDelay);
      } catch (reason) {
        if (!cancelled) {
          setError({ key: requestKey, message: String(reason) });
          setPendingKey(null);
        }
      }
    };
    timer = setTimeout(() => void run(), 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    api,
    key,
    requestKey,
    query,
    type,
    context,
    offset,
    matching,
    request.retry,
    request.snapshot,
    paused,
    enabled,
    pollDelay,
  ]);
  const result = data?.key === key ? data.result : null;
  const failure = error?.key === requestKey ? error.message : '';
  const busy = enabled && (pendingKey === requestKey || (data?.requestKey !== requestKey && !failure));
  return {
    key: JSON.stringify([key, data?.key === key ? data.resetRevision : 0]),
    result,
    error: failure,
    busy,
    loadingMore: busy && offset > 0 && Boolean(result?.items.length),
    paused,
    hasMore: result?.nextOffset != null,
    pause: () => setPaused((value) => !value),
    refresh: () =>
      setRequest((current) => ({
        query,
        type,
        context,
        offset: 0,
        snapshot: '',
        revision: current.revision + 1,
        attempt: 0,
        retry: true,
      })),
    more: () => {
      if (!enabled || busy || result?.nextOffset == null) return;
      const nextOffset = result.nextOffset;
      setRequest((current) => {
        // Multiple intersection notifications must schedule only one page request.
        if (current.offset === nextOffset && current.snapshot === result.snapshot && !failure) return current;
        return {
          ...current,
          offset: nextOffset,
          snapshot: result.snapshot,
          attempt: current.attempt + 1,
          retry: false,
        };
      });
    },
  };
}
