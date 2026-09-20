import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEntityRef, CalendarPreferences } from '@/shared/contracts/calendar';
import type { CalendarUsageQuery, CalendarUsageResult, CalendarUsageRunsResult } from '@/shared/calendar-usage';

interface Options {
  spaceId: string;
  date: string;
  timeZone: string;
  source: CalendarPreferences['usageSource'];
  active: boolean;
  dataRevision: number;
}

type Failure = 'load' | 'stale';
const failureKind = (failure: unknown): Failure => (/STALE/.test(String(failure)) ? 'stale' : 'load');

export function useCalendarUsageDetails({ spaceId, date, timeZone, source, active, dataRevision }: Options) {
  const [selectedSource, setSelectedSource] = useState(source);
  const [modelAttribution, setModelAttribution] = useState<'REQUESTED' | 'OBSERVED'>('REQUESTED');
  const [model, setModel] = useState<string | null | undefined>(undefined);
  const [target, setTarget] = useState<CalendarEntityRef | null | undefined>(undefined);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [scope, setScope] = useState<{ key: string; result: CalendarUsageResult } | null>(null);
  const [scopeError, setScopeError] = useState<{ key: string; failure: Failure } | null>(null);
  const [details, setDetails] = useState<{
    key: string;
    summary: CalendarUsageResult;
    page: CalendarUsageRunsResult;
  } | null>(null);
  const [detailError, setDetailError] = useState<{ key: string; failure: Failure } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);
  const pendingPage = useRef(false);
  const baseQuery = useMemo<CalendarUsageQuery>(
    () => ({
      startDate: date,
      endDate: date,
      timeZone,
      ...(selectedSource === 'all' ? {} : { sources: [selectedSource] }),
    }),
    [date, timeZone, selectedSource],
  );
  const scopeKey = JSON.stringify([spaceId, baseQuery, dataRevision, refreshRevision]);
  const options = scope?.key === scopeKey ? scope.result : null;
  const query = useMemo<CalendarUsageQuery | null>(
    () => (options ? { ...baseQuery, snapshot: options.snapshot, modelAttribution, model, target } : null),
    [options, baseQuery, modelAttribution, model, target],
  );
  const detailKey = JSON.stringify([scopeKey, query]);
  const current = details?.key === detailKey ? details : null;
  const error =
    scopeError?.key === scopeKey ? scopeError.failure : detailError?.key === detailKey ? detailError.failure : null;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setScopeError(null);
    void window.desktopApi.calendar.usage(baseQuery, spaceId).then(
      (result) => {
        if (!cancelled) setScope({ key: scopeKey, result });
      },
      (failure) => {
        if (!cancelled) setScopeError({ key: scopeKey, failure: failureKind(failure) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, baseQuery, spaceId, scopeKey]);

  useEffect(() => {
    if (!active || !query || !options) return;
    const request = ++requestId.current;
    setDetailError(null);
    setLoadingMore(false);
    pendingPage.current = false;
    const summary =
      model === undefined && target === undefined
        ? Promise.resolve(options)
        : window.desktopApi.calendar.usage(query, spaceId);
    void Promise.all([summary, window.desktopApi.calendar.usageRuns({ ...query, limit: 50 }, spaceId)]).then(
      ([result, page]) => {
        if (request === requestId.current) setDetails({ key: detailKey, summary: result, page });
      },
      (failure) => {
        if (request === requestId.current) setDetailError({ key: detailKey, failure: failureKind(failure) });
      },
    );
    return () => {
      requestId.current += 1;
    };
  }, [active, query, options, model, target, spaceId, detailKey]);

  useEffect(() => {
    if (modelAttribution === 'OBSERVED' && options && !options.models.some((value) => value.observedModel !== null)) {
      setModelAttribution('REQUESTED');
      setModel(undefined);
    }
  }, [modelAttribution, options]);

  const refresh = useCallback(() => setRefreshRevision((revision) => revision + 1), []);
  const changeSource = useCallback((value: CalendarPreferences['usageSource']) => {
    setSelectedSource(value);
    setModel(undefined);
    setTarget(undefined);
  }, []);
  const changeAttribution = useCallback((value: 'REQUESTED' | 'OBSERVED') => {
    setModelAttribution(value);
    setModel(undefined);
  }, []);
  const loadMore = useCallback(async () => {
    if (!active || !query || !current?.page.nextCursor || pendingPage.current || error === 'stale') return;
    const request = requestId.current;
    pendingPage.current = true;
    setLoadingMore(true);
    setDetailError(null);
    try {
      const next = await window.desktopApi.calendar.usageRuns(
        { ...query, limit: 50, cursor: current.page.nextCursor },
        spaceId,
      );
      if (request !== requestId.current) return;
      setDetails((previous) =>
        previous?.key === detailKey
          ? { ...previous, page: { ...next, runs: [...previous.page.runs, ...next.runs] } }
          : previous,
      );
    } catch (failure) {
      if (request === requestId.current) setDetailError({ key: detailKey, failure: failureKind(failure) });
    } finally {
      if (request === requestId.current) {
        pendingPage.current = false;
        setLoadingMore(false);
      }
    }
  }, [active, query, current, error, spaceId, detailKey]);

  return {
    source: selectedSource,
    changeSource,
    modelAttribution,
    changeAttribution,
    model,
    setModel,
    target,
    setTarget,
    options,
    summary: current?.summary ?? null,
    page: current?.page ?? null,
    loading: active && !current && !error,
    loadingMore,
    error,
    refresh,
    loadMore,
  };
}
