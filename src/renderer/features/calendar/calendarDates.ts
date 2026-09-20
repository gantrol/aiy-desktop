/** Calendar days are civil dates, never midnight instants in the machine's zone. */
function civilDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function civilKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function dateInTimeZone(instant: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function shiftDate(date: string, days: number) {
  const value = civilDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return civilKey(value);
}

export function shiftMonth(date: string, months: number) {
  const value = civilDate(date);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0, 12)).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return civilKey(value);
}

/** A bounded, week-aligned strip that can cross calendar years. */
export function calendarWindowStart(date: string) {
  const first = shiftDate(date, -182);
  const aligned = shiftDate(first, -((civilDate(first).getUTCDay() + 6) % 7));
  return aligned < '1000-01-01'
    ? '1000-01-01'
    : aligned > shiftDate('9998-12-31', -363)
      ? shiftDate('9998-12-31', -363)
      : aligned;
}

export function calendarWindowDays(start: string) {
  return Array.from({ length: 364 }, (_, index) => shiftDate(start, index));
}

export function formatCivilDate(date: string, locale: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(civilDate(date));
}

export function wallTimeInZone(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

/** Returns every possible instant so a daylight-saving fold is never silently guessed. */
export function wallTimeCandidates(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const wallUtc = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wallUtc)) return [];
  const offsets = new Set<number>();
  // Sampling both sides of a transition supports 30-minute and 24-hour zone changes too.
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    const probe = wallUtc + hours * 3_600_000;
    offsets.add(Date.parse(`${wallTimeInZone(new Date(probe).toISOString(), timeZone)}:00Z`) - probe);
  }
  return [...offsets]
    .map((offset) => new Date(wallUtc - offset).toISOString())
    .filter((instant) => wallTimeInZone(instant, timeZone) === value)
    .sort();
}

export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
