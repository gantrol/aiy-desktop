import type { ComboboxOption } from '@/renderer/components/ui/combobox';
import type { MessageCatalog } from '@/renderer/i18n/types';

type Messages = MessageCatalog['calendar'];

export function canonicalTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
}

export function sameTimeZone(first: string, second: string) {
  return first === second || canonicalTimeZone(first) === canonicalTimeZone(second);
}

function timeZoneOffset(timeZone: string, now: Date) {
  const offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')!.value;
  return offset === 'GMT' ? 'UTC+00:00' : offset.replace('GMT', 'UTC');
}

function cityLabel(canonical: string, m: Messages) {
  return m.timeZoneCities[canonical as keyof typeof m.timeZoneCities] ?? canonical.replaceAll('_', ' ');
}

export function calendarTimeZoneLabel(timeZone: string, m: Messages, now = new Date()) {
  return `${timeZoneOffset(timeZone, now)} · ${cityLabel(canonicalTimeZone(timeZone), m)}`;
}

export function calendarTimeZoneOptions(
  current: string,
  system: string,
  locale: string,
  m: Messages,
): ComboboxOption[] {
  const now = new Date();
  const pinned = new Set([current, system, 'UTC'].map(canonicalTimeZone));
  const seen = new Set<string>();
  const options = [current, system, 'UTC', ...Intl.supportedValuesOf('timeZone')].flatMap((value) => {
    const canonical = canonicalTimeZone(value);
    if (seen.has(canonical)) return [];
    seen.add(canonical);
    const name = new Intl.DateTimeFormat(locale, { timeZone: value, timeZoneName: 'longGeneric' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')!.value;
    const offset = timeZoneOffset(value, now);
    const minutes = (Number(offset.slice(4, 6)) * 60 + Number(offset.slice(7, 9))) * (offset[3] === '-' ? -1 : 1);
    return [
      {
        value,
        label: `${offset} · ${cityLabel(canonical, m)}`,
        keywords: `${canonical} ${canonical.replaceAll('_', ' ')} ${name}`,
        group: pinned.has(canonical) ? m.timeZonePinned : m.timeZoneAll,
        minutes,
      },
    ];
  });
  const collator = new Intl.Collator(locale);
  return options.sort((first, second) => {
    if (first.group !== second.group) return first.group === m.timeZonePinned ? -1 : 1;
    if (first.group === m.timeZonePinned) return 0;
    return first.minutes - second.minutes || collator.compare(first.label, second.label);
  });
}
