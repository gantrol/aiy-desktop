import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CodexHistoryMessage, CodexHistoryRoleFilter, CodexHistoryThreadMessagesPage } from '@/shared/contracts';

const PAGE_SIZE = 20;
type Direction = 'OLDER' | 'NEWER';
type ScrollAdjustment = 'TOP' | 'BOTTOM' | 'ANCHOR' | { top: number; height?: number };

function mergePage(
  current: CodexHistoryThreadMessagesPage,
  next: CodexHistoryThreadMessagesPage,
  direction: Direction,
) {
  const known = new Set(current.messages.map(({ messageId }) => messageId));
  const added = next.messages.filter(({ messageId }) => !known.has(messageId));
  return {
    ...current,
    messages: direction === 'OLDER' ? [...added, ...current.messages] : [...current.messages, ...added],
    nextCursor: direction === 'OLDER' ? next.nextCursor : current.nextCursor,
    newerCursor: direction === 'NEWER' ? next.nextCursor : current.newerCursor,
    scanLimited: current.scanLimited || next.scanLimited,
  };
}

export function useCodexHistoryMessages(threadId: string, query: string, role: CodexHistoryRoleFilter) {
  const [results, setResults] = useState<CodexHistoryThreadMessagesPage | null>(null);
  const [context, setContext] = useState<CodexHistoryThreadMessagesPage | null>(null);
  const [anchor, setAnchor] = useState<CodexHistoryMessage | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState<Direction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const revision = useRef(0);
  const pending = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const adjustment = useRef<ScrollAdjustment | null>(null);
  const resultsScroll = useRef(0);
  const filtered = Boolean(query.trim() || role !== 'ALL');
  const page = anchor ? context : results;

  useEffect(() => {
    const request = ++revision.current;
    pending.current = true;
    setResults(null);
    setContext(null);
    setAnchor(null);
    setFocusMessageId(null);
    setLoading(true);
    setLoadingMore(null);
    setError(null);
    adjustment.current = null;
    void window.desktopApi
      .codexHistoryThreadMessages({ threadId, query, role, cursor: null, pageSize: PAGE_SIZE })
      .then((next) => {
        if (revision.current !== request) return;
        adjustment.current = filtered ? 'TOP' : 'BOTTOM';
        setResults(next);
      })
      .catch((reason) => {
        if (revision.current === request) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (revision.current === request) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => {
      revision.current += 1;
    };
  }, [threadId, query, role, filtered, reload]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const scroll = adjustment.current;
    if (!container || !scroll || loading) return;
    if (scroll === 'TOP') container.scrollTop = 0;
    else if (scroll === 'BOTTOM') container.scrollTop = container.scrollHeight;
    else if (scroll === 'ANCHOR') {
      const target = focusRef.current;
      if (target) {
        container.scrollTop +=
          target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 3;
        target.focus({ preventScroll: true });
      }
    } else {
      container.scrollTop = scroll.top + (scroll.height === undefined ? 0 : container.scrollHeight - scroll.height);
      focusRef.current?.focus({ preventScroll: true });
    }
    adjustment.current = null;
  }, [page, loading]);

  const viewContext = useCallback(
    async (message: CodexHistoryMessage) => {
      if (!message.position) return;
      const request = ++revision.current;
      if (!anchor) resultsScroll.current = containerRef.current?.scrollTop ?? 0;
      setAnchor(message);
      setFocusMessageId(message.messageId);
      setContext(null);
      setLoading(true);
      setLoadingMore(null);
      setError(null);
      pending.current = true;
      try {
        const next = await window.desktopApi.codexHistoryThreadMessages({
          threadId,
          anchor: message.position,
          cursor: null,
          pageSize: PAGE_SIZE,
        });
        if (revision.current !== request) return;
        adjustment.current = 'ANCHOR';
        setContext(next);
      } catch (reason) {
        if (revision.current === request) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (revision.current === request) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [threadId, anchor],
  );

  const backToResults = useCallback(() => {
    revision.current += 1;
    pending.current = false;
    adjustment.current = { top: resultsScroll.current };
    setAnchor(null);
    setContext(null);
    setLoading(false);
    setLoadingMore(null);
    setError(null);
  }, []);

  const loadMore = useCallback(
    async (direction: Direction) => {
      const cursor = direction === 'OLDER' ? page?.nextCursor : page?.newerCursor;
      if (!page || cursor == null || pending.current) return;
      const request = ++revision.current;
      pending.current = true;
      setLoadingMore(direction);
      setError(null);
      try {
        const next = await window.desktopApi.codexHistoryThreadMessages({
          threadId,
          query: anchor ? '' : query,
          role: anchor ? 'ALL' : role,
          cursor,
          direction,
          pageSize: PAGE_SIZE,
        });
        if (revision.current !== request) return;
        const container = containerRef.current;
        if (container)
          adjustment.current = {
            top: container.scrollTop,
            height: direction === 'OLDER' && (anchor || !filtered) ? container.scrollHeight : undefined,
          };
        const setPage = anchor ? setContext : setResults;
        setPage((current) => (current ? mergePage(current, next, direction) : next));
      } catch (reason) {
        if (revision.current === request) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (revision.current === request) {
          pending.current = false;
          setLoadingMore(null);
        }
      }
    },
    [page, threadId, query, role, anchor, filtered],
  );

  return {
    page,
    anchor,
    filtered,
    focusMessageId,
    containerRef,
    focusRef,
    loading,
    loadingMore,
    error,
    viewContext,
    backToResults,
    loadMore,
    retry: () => (anchor ? void viewContext(anchor) : setReload((value) => value + 1)),
  };
}
