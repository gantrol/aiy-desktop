import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageSearchResult, ImageSearchResponse, WorkspaceSearchMode } from '@/shared/contracts/image-search';

type SearchError = Extract<ImageSearchResponse, { error: string }>['error'] | '';

function receivePage(previous: ImageSearchResult | null, page: ImageSearchResult, offset: number) {
  if (!previous || previous.snapshot !== page.snapshot || page.reset) return page;
  const tail = previous.items.slice(offset + page.items.length);
  const items = [...previous.items.slice(0, offset), ...page.items, ...tail];
  return {
    ...page,
    items: [...new Map(items.map((item) => [item.id, item])).values()],
    nextOffset: tail.length ? previous.nextOffset : page.nextOffset,
  };
}

export function useImageSearch(query: string, active: boolean, mode: WorkspaceSearchMode = 'SEMANTIC') {
  const [refreshKey, setRefreshKey] = useState(0);
  const key = JSON.stringify([query, mode, refreshKey]);
  const [state, setState] = useState<{ key: string; result: ImageSearchResult | null }>({ key, result: null });
  const latestState = useRef(state);
  latestState.current = state;
  const [error, setError] = useState<SearchError>('');
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const retryUnavailable = useRef(false);
  const request = useRef<string | null>(null);
  const revision = useRef(0);
  const [visible, setVisible] = useState(!document.hidden);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const result = state.key === key ? state.result : null;
  useEffect(() => {
    const current = ++revision.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let indexLease: string | null = null;
    setError('');
    setBusy(false);
    const api = window.desktopApi?.imageSearch;
    if (!active || !visible || !query.trim()) return;
    if (!api) {
      setError('NOT_CONFIGURED');
      return;
    }
    const run = async () => {
      // Polling must never replace an in-flight page request in the main-process queue.
      if (request.current) {
        timer = setTimeout(() => void run(), 1_500);
        return;
      }
      const retained = latestState.current.key === key ? latestState.current.result : null;
      // Refresh the last visible keyword page; OCR appends matches to this search session.
      const offset = mode === 'TEXT' && retained ? Math.floor(Math.max(0, retained.items.length - 1) / 30) * 30 : 0;
      const requestId = crypto.randomUUID();
      indexLease = requestId;
      request.current = requestId;
      setBusy(!retained);
      const retry = retryUnavailable.current;
      retryUnavailable.current = false;
      try {
        const lookup = mode === 'TEXT' ? api.lookupMetadata : api.lookup;
        const response = await lookup({
          requestId,
          query,
          mode,
          offset,
          snapshot: mode === 'TEXT' ? retained?.snapshot : undefined,
          advanceIndex: !paused,
          retryUnavailable: retry,
        });
        if (revision.current !== current) return;
        if ('error' in response) {
          setError(response.error);
          return;
        }
        setError('');
        const page = response.result;
        setState((previous) => ({
          key,
          result: receivePage(previous.key === key ? previous.result : null, page, offset),
        }));
        if (!paused && response.result.coverage.pending && !response.result.indexError)
          timer = setTimeout(() => void run(), 1_500);
      } catch {
        if (revision.current === current) setError('UNAVAILABLE');
      } finally {
        if (revision.current === current) {
          request.current = null;
          setBusy(false);
        }
      }
    };
    timer = setTimeout(() => void run(), 250);
    return () => {
      invalidate();
      clearTimeout(timer);
      if (request.current) void api.cancel(request.current).catch(() => undefined);
      if (indexLease && indexLease !== request.current) void api.cancel(indexLease).catch(() => undefined);
      request.current = null;
    };
  }, [query, key, mode, active, visible, paused, refreshKey, invalidate]);

  const more = async () => {
    const api = window.desktopApi?.imageSearch;
    if (!api || !active || !visible || busy || request.current || result?.nextOffset == null) return;
    const current = revision.current;
    const offset = result.nextOffset;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setBusy(true);
    setError('');
    try {
      const lookup = mode === 'TEXT' ? api.lookupMetadata : api.lookup;
      const response = await lookup({
        requestId,
        query,
        mode,
        offset,
        snapshot: result.snapshot,
        advanceIndex: false,
      });
      if (current !== revision.current) return;
      if ('error' in response) {
        setError(response.error);
        return;
      }
      setState((previous) => ({
        key,
        result: receivePage(previous.key === key ? previous.result : null, response.result, offset),
      }));
    } catch {
      if (current === revision.current) setError('UNAVAILABLE');
    } finally {
      if (current === revision.current) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return {
    key: JSON.stringify([key, mode === 'TEXT' ? result?.snapshot : null]),
    result,
    error,
    busy,
    paused,
    setPaused,
    more,
    refresh: () => {
      retryUnavailable.current = true;
      setRefreshKey((value) => value + 1);
    },
  };
}
