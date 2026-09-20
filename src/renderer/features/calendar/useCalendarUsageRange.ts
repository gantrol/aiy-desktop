import { useEffect, useState } from 'react';
import type { CalendarPreferences } from '@/shared/contracts/calendar';
import type { CalendarUsageResult } from '@/shared/calendar-usage';

export function useCalendarUsageRange(
  spaceId: string,
  startDate: string,
  endDate: string,
  preferences: CalendarPreferences,
  active: boolean,
  dataRevision: number,
  refreshRevision: number,
) {
  const [usage, setUsage] = useState<CalendarUsageResult | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setError(false);
    if (!active || !preferences.showUsage) return;
    void window.desktopApi.calendar
      .usage(
        {
          startDate,
          endDate,
          timeZone: preferences.timeZone,
          ...(preferences.usageSource === 'all' ? {} : { sources: [preferences.usageSource] }),
        },
        spaceId,
      )
      .then(
        (next) => {
          if (!cancelled) setUsage(next);
        },
        () => {
          if (!cancelled) setError(true);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [
    spaceId,
    startDate,
    endDate,
    preferences.timeZone,
    preferences.usageSource,
    preferences.showUsage,
    active,
    dataRevision,
    refreshRevision,
  ]);
  return { usage, error };
}
