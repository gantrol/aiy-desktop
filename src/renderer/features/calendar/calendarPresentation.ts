import { formatCivilDate } from '@/renderer/features/calendar/calendarDates';
import type { MessageCatalog } from '@/renderer/i18n/types';
import type { CalendarItem, CalendarTime } from '@/shared/contracts/calendar';

export function calendarOperationLabel(operation: string | null, messages: MessageCatalog['calendar']) {
  if (!operation) return messages.activityChange;
  const key = operation.toUpperCase().replace(/[-.]/g, '_');
  return messages.operations[key as keyof typeof messages.operations] ?? messages.activityChange;
}

function entityLabel(type: string | undefined | null, m: MessageCatalog['calendar']) {
  return m.entityTypes[type as keyof typeof m.entityTypes] ?? m.activityObject;
}

function format(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

function changeLabel(change: CalendarItem['changes'][number], item: CalendarItem, m: MessageCatalog['calendar']) {
  const operation = change.operation.toUpperCase().replace(/[-.]/g, '_');
  const type =
    item.sourceType && ['ALBUM', 'IMAGE_ASSET', 'VIDEO_ASSET'].includes(change.entityType)
      ? item.sourceType
      : change.entityType;
  const key = `${type}_${operation}`;
  return (
    m.changeLabels[key as keyof typeof m.changeLabels] ??
    format(m.typedOperation, { type: entityLabel(type, m), operation: calendarOperationLabel(operation, m) })
  );
}

export function calendarChangeLabels(item: CalendarItem, m: MessageCatalog['calendar']) {
  const counts = new Map<string, number>();
  for (const change of item.changes) {
    const label = changeLabel(change, item, m);
    counts.set(label, (counts.get(label) ?? 0) + change.count);
  }
  return [...counts].map(([label, count]) =>
    count > 1 ? m.changeCount.replace('{change}', label).replace('{count}', String(count)) : label,
  );
}

export function calendarChangePreview(item: CalendarItem, m: MessageCatalog['calendar']) {
  const labels = calendarChangeLabels(item, m);
  return [
    ...labels.slice(0, 3),
    ...(labels.length > 3 ? [m.moreChanges.replace('{count}', String(labels.length - 3))] : []),
  ].join(' · ');
}

export function calendarItemTitle(item: CalendarItem, messages: MessageCatalog['calendar']) {
  if (item.packSync) {
    const sync = item.packSync;
    const title = messages.packSyncTitles[sync.kind][sync.status];
    return title.replace('{count}', String(sync.packs.filter((pack) => pack.status === 'SUCCEEDED').length));
  }
  const type = item.sourceType ?? item.activitySummary?.object.type ?? item.entity?.type;
  const entity = entityLabel(type, messages);
  const fallback = item.historical
    ? messages.historicalObject
    : item.entity?.available === false
      ? messages.unavailableObject
      : messages.unnamedObject;
  const name = item.title.trim() || format(fallback, { type: entity });
  const change =
    item.changes[0] ??
    (item.operation && item.entity ? { entityType: item.entity.type, operation: item.operation, count: 1 } : null);
  const activity = item.activityCount > 1 || !change ? entity : changeLabel(change, item, messages);
  return format(messages.namedActivity, { name, activity });
}

export function calendarActivityContext(item: CalendarItem, m: MessageCatalog['calendar']) {
  const type = item.sourceType ?? item.activitySummary?.object.type ?? item.entity?.type;
  const entity = entityLabel(type, m);
  const categories = item.activitySummary?.categories ?? [item.category];
  return [
    entity,
    ...Object.keys(m.categories)
      .filter((key) => categories.includes(key as (typeof categories)[number]))
      .map((key) => m.categories[key as keyof typeof m.categories]),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function calendarActivityTime(
  item: CalendarItem,
  locale: string,
  timeZone: string,
  m: MessageCatalog['calendar'],
  display: 'range' | 'latest' = 'range',
) {
  const summary = item.activitySummary;
  if (!summary?.firstAt || !summary.lastAt) return formatCalendarTime(item.when, locale, timeZone, m.allDay);
  const format = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' });
  const first = format.format(new Date(summary.firstAt));
  const last = format.format(new Date(summary.lastAt));
  if (display === 'latest' && first !== last) return `${m.lastActivityAt} ${last}`;
  return first === last ? first : `${m.firstActivityAt} ${first} · ${m.lastActivityAt} ${last}`;
}

export function formatCalendarTime(time: CalendarTime, locale: string, timeZone: string, allDay: string) {
  if (time.kind === 'allDay') {
    const first = formatCivilDate(time.date, locale, { year: 'numeric', month: 'short', day: 'numeric' });
    const end =
      time.endDate && time.endDate !== time.date
        ? ` – ${formatCivilDate(time.endDate, locale, { month: 'short', day: 'numeric' })}`
        : '';
    return `${first}${end} · ${allDay}`;
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `${formatter.format(new Date(time.startAt))}${time.endAt ? ` – ${formatter.format(new Date(time.endAt))}` : ''}`;
}
