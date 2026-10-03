import { useEffect, useState } from 'react';
import { deviceTimeZone } from '@/renderer/features/calendar/calendarDates';
import { sameTimeZone } from '@/renderer/features/calendar/calendarTimeZones';
import type { CalendarPreferences } from '@/shared/contracts/calendar';

export function useCalendarSystemTimeZone(
  preferences: CalendarPreferences,
  active: boolean,
  onChange: (patch: Partial<CalendarPreferences>) => void,
) {
  const [systemTimeZone, setSystemTimeZone] = useState(deviceTimeZone);
  useEffect(() => {
    if (!active) return;
    const check = () => {
      if (document.visibilityState !== 'hidden') setSystemTimeZone(deviceTimeZone());
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [active]);

  const { timeZone, followSystemTimeZone, lastSystemTimeZone } = preferences;
  const matches = sameTimeZone(timeZone, systemTimeZone);
  const observed = lastSystemTimeZone !== undefined && sameTimeZone(lastSystemTimeZone, systemTimeZone);
  useEffect(() => {
    if (!active) return;
    if (followSystemTimeZone && (!matches || !observed)) {
      onChange({ timeZone: systemTimeZone, lastSystemTimeZone: systemTimeZone });
    } else if (matches && !observed) {
      onChange({ lastSystemTimeZone: systemTimeZone });
    }
  }, [active, followSystemTimeZone, matches, observed, systemTimeZone, onChange]);

  return active && !followSystemTimeZone && !matches && !observed ? systemTimeZone : null;
}
