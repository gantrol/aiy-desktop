import { calendarDateSchema, calendarTimeZoneSchema } from '@/shared/contracts/calendar';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateStarts = new Map<string, number>();
function formatter(timeZone: string) {
  let value = dateFormatters.get(timeZone);
  if (!value) {
    calendarTimeZoneSchema.parse(timeZone);
    value = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    // User-selected zones are bounded; avoid retaining an unbounded formatter cache.
    if (dateFormatters.size >= 32) dateFormatters.clear();
    dateFormatters.set(timeZone, value);
  }
  return value;
}
export function calendarLocalDate(value: string | number, timeZone: string) {
  const parts = new Map(
    formatter(timeZone)
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get('year')!.padStart(4, '0')}-${parts.get('month')}-${parts.get('day')}`;
}
export function calendarNextDate(value: string) {
  const date = new Date(`${calendarDateSchema.parse(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
/** First instant of this local date, including zones with a midnight offset transition. */
export function calendarDateStartEpoch(value: string, timeZone: string) {
  // The exclusive end after the last publicly supported date is an internal boundary.
  const date = value === '9999-01-01' ? value : calendarDateSchema.parse(value);
  const cacheKey = `${timeZone}:${date}`;
  const cached = dateStarts.get(cacheKey);
  if (cached !== undefined) return cached;
  const center = Date.parse(`${date}T12:00:00.000Z`);
  let low = center - 48 * 3600000;
  let high = center + 48 * 3600000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (calendarLocalDate(middle, timeZone) < date) low = middle + 1;
    else high = middle;
  }
  if (dateStarts.size >= 1024) dateStarts.clear();
  dateStarts.set(cacheKey, low);
  return low;
}
/** Inclusive calendar dates; the returned end instant is exclusive. */
export function calendarDateRangeEpochs(startDate: string, endDate: string, timeZone: string) {
  return {
    fromEpoch: calendarDateStartEpoch(startDate, timeZone),
    toEpoch: calendarDateStartEpoch(calendarNextDate(endDate), timeZone),
  };
}
