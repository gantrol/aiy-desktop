import type { CalendarItem, CalendarTime } from '@/shared/contracts/calendar';
import { dateInTimeZone } from '@/renderer/features/calendar/calendarDates';

function bounds(time: CalendarTime, timeZone: string) {
  if (time.kind === 'allDay') return [time.date, time.endDate ?? time.date] as const;
  const start = dateInTimeZone(time.startAt, timeZone);
  return [
    start,
    time.endAt
      ? dateInTimeZone(new Date(Math.max(Date.parse(time.startAt), Date.parse(time.endAt) - 1)), timeZone)
      : start,
  ] as const;
}

export function calendarEntriesByDay(
  items: CalendarItem[],
  days: string[],
  timeZone: string,
  timeAxis: 'effective' | 'recorded' = 'effective',
) {
  const result = new Map<string, CalendarItem[]>(days.map((day) => [day, []]));
  for (const item of items) {
    const stamp = timeAxis === 'recorded' ? item.displayWhen : item.when;
    if (!stamp) continue;
    const [first, last] = bounds(stamp, timeZone);
    for (const day of days) {
      if (first <= day && day <= last) result.get(day)!.push(item);
    }
  }
  return result;
}
