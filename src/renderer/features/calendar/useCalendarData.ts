import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarPreferences, CalendarSummaryResult } from '@/shared/contracts/calendar';
import { useCalendarUsageRange } from '@/renderer/features/calendar/useCalendarUsageRange';
import { useCalendarDayData } from '@/renderer/features/calendar/useCalendarDayData';
import { deviceTimeZone } from '@/renderer/features/calendar/calendarDates';

function initialPreferences(): CalendarPreferences {
  return {
    timeZone: deviceTimeZone(),
    categories: ['content', 'organization', 'knowledge', 'ai', 'delivery', 'workspace', 'other'],
    showInvalidated: false,
    timeAxis: 'effective',
    showUsage: false,
    usageMetric: 'calls',
    usageSource: 'all',
    weekStartsOn: 1,
  };
}

export function useCalendarData(
  spaceId: string,
  range: { startDate: string; endDate: string },
  selectedDate: string,
  active: boolean,
  dataRevision: number,
  knownAt?: string,
) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const preferencesRef = useRef(preferences);
  const [ready, setReady] = useState(false);
  const [preferenceError, setPreferenceError] = useState(false);
  const [summaryState, setSummary] = useState<{ scope: object; value: CalendarSummaryResult } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const alive = useRef(true);
  const preferenceWrites = useRef<Promise<unknown>>(Promise.resolve());
  const filters = useMemo(
    () => ({
      timeZone: preferences.timeZone,
      categories: preferences.categories,
      includeInvalidated: preferences.showInvalidated,
      timeAxis: preferences.timeAxis,
      knownAt,
    }),
    [preferences.timeZone, preferences.categories, preferences.showInvalidated, preferences.timeAxis, knownAt],
  );
  const summaryScope = useMemo(
    () => ({ filters, spaceId, dataRevision, refreshRevision, active }),
    [filters, spaceId, dataRevision, refreshRevision, active],
  );
  const summary = summaryState?.scope === summaryScope ? summaryState.value : null;
  const query = useMemo(
    () => ({
      ...filters,
      startDate: selectedDate,
      endDate: selectedDate,
      limit: 100,
    }),
    [filters, selectedDate],
  );
  const refresh = useCallback(() => setRefreshRevision((revision) => revision + 1), []);
  const day = useCalendarDayData(spaceId, query, ready && active, filters, dataRevision, refreshRevision, refresh);
  const { usage: dayUsage, error: dayUsageError } = useCalendarUsageRange(
    spaceId,
    day.date,
    day.date,
    preferences,
    ready && active && !knownAt && Boolean(day.result),
    dataRevision,
    refreshRevision,
  );

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void window.desktopApi.calendar.getPreferences(spaceId).then(
      (stored) => {
        if (cancelled) return;
        preferencesRef.current = stored;
        setPreferences(stored);
        setReady(true);
      },
      () => {
        if (cancelled) return;
        setPreferenceError(true);
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [spaceId]);

  useEffect(() => {
    if (!ready || !active) return;
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(false);
    void window.desktopApi.calendar.summary({ ...range, ...filters }, spaceId).then(
      (next) => {
        if (cancelled) return;
        setSummary({ scope: summaryScope, value: next });
        setSummaryLoading(false);
      },
      () => {
        if (cancelled) return;
        setSummaryError(true);
        setSummaryLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ready, active, range, filters, spaceId, summaryScope]);

  const updatePreferences = useCallback(
    (patch: Partial<CalendarPreferences>) => {
      const next = { ...preferencesRef.current, ...patch };
      preferencesRef.current = next;
      setPreferences(next);
      setPreferenceError(false);
      preferenceWrites.current = preferenceWrites.current
        .catch(() => undefined)
        .then(async () => {
          if (!alive.current) return;
          try {
            await window.desktopApi.calendar.savePreferences(next, spaceId);
          } catch {
            if (alive.current) setPreferenceError(true);
          }
        });
    },
    [spaceId],
  );

  return {
    preferences,
    updatePreferences,
    ready,
    preferenceError,
    summary,
    summaryLoading,
    summaryError,
    ...day,
    dayUsage,
    dayUsageError,
    refresh,
  };
}
