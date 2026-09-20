import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarQueryInput, CalendarQueryResult } from '@/shared/contracts/calendar';
import { CalendarDayCache } from '@/renderer/features/calendar/calendarDayCache';
import { shiftDate } from '@/renderer/features/calendar/calendarDates';

export function useCalendarDayData(
  spaceId: string,
  query: CalendarQueryInput,
  active: boolean,
  scope: object,
  dataRevision: number,
  refreshRevision: number,
  refresh: () => void,
) {
  const [cache] = useState(() => new CalendarDayCache());
  const generation = useRef(0);
  const pendingPage = useRef(false);
  const cacheScope = useMemo(
    () => ({ spaceId, active, scope, dataRevision, refreshRevision }),
    [spaceId, active, scope, dataRevision, refreshRevision],
  );
  const identity = useMemo(() => ({ query, cacheScope }), [query, cacheScope]);
  const [state, setState] = useState<{
    identity: typeof identity | null;
    result: CalendarQueryResult | null;
    loadingMore: boolean;
    error: boolean;
  }>({ identity: null, result: null, loadingMore: false, error: false });

  useEffect(() => {
    cache.reset(cacheScope);
    return () => cache.reset();
  }, [cache, cacheScope]);

  useEffect(() => {
    if (!active) return;
    const request = ++generation.current;
    pendingPage.current = false;
    void cache.read(query, spaceId, true).then(
      (result) => {
        if (generation.current === request) setState({ identity, result, loadingMore: false, error: false });
      },
      () => {
        if (generation.current === request) setState({ identity, result: null, loadingMore: false, error: true });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [cache, query, spaceId, active, identity]);

  const settled = state.identity === identity;
  const currentResult = active ? (settled ? state.result : cache.peek(query.startDate, cacheScope)) : null;
  // Keep the last day and its heading together until the next day is ready.
  // A different space, filter or historical cutoff must never reuse that display.
  const previousResult =
    active && !settled && state.identity?.cacheScope.spaceId === spaceId && state.identity.cacheScope.scope === scope
      ? state.result
      : null;
  const result = currentResult ?? previousResult;
  const date = !currentResult && previousResult ? state.identity!.query.startDate : query.startDate;
  const loading = active && !settled && !currentResult;
  useEffect(() => {
    if (!active || !currentResult) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const offset of [-1, 1, -2, 2]) {
          if (cancelled) break;
          const date = shiftDate(query.startDate, offset);
          if (date < '1000-01-01' || date > '9998-12-31') continue;
          try {
            await cache.read({ ...query, startDate: date, endDate: date }, spaceId);
          } catch {
            // A speculative failure must not replace the selected day's result.
          }
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cache, query, spaceId, active, currentResult]);

  const loadMore = useCallback(async () => {
    if (!active || !settled || !result?.nextCursor || pendingPage.current) return;
    const request = generation.current;
    pendingPage.current = true;
    setState((current) => ({ ...current, loadingMore: true, error: false }));
    try {
      const next = await window.desktopApi.calendar.query({ ...query, cursor: result.nextCursor }, spaceId);
      if (request === generation.current) {
        setState((current) => ({ ...current, result: { ...next, items: [...result.items, ...next.items] } }));
      }
    } catch (failure) {
      if (request !== generation.current) return;
      if (String(failure).includes('CALENDAR_CURSOR_STALE')) refresh();
      else setState((current) => ({ ...current, error: true }));
    } finally {
      if (request === generation.current) {
        pendingPage.current = false;
        setState((current) => ({ ...current, loadingMore: false }));
      }
    }
  }, [active, settled, result, query, spaceId, refresh]);

  return {
    result,
    date,
    loading,
    loadingMore: state.identity === identity && state.loadingMore,
    error: state.identity === identity && state.error,
    loadMore,
  };
}
