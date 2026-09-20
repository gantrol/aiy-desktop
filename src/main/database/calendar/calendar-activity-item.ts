import type { CalendarItem, CalendarTime } from '@/shared/contracts/calendar';
import { calendarItemSchema } from '@/shared/contracts/calendar';
import type { CalendarReadFilter, CalendarReadRow } from '@/main/database/calendar/calendar-read-rows';
import { CalendarSourceReader } from '@/main/database/calendar/calendar-sources';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const optionalText = (value: unknown) => (typeof value === 'string' ? value : null);

export function calendarActivityItemFromReadRow(
  row: CalendarReadRow,
  input: CalendarReadFilter,
  sources: CalendarSourceReader,
): CalendarItem {
  const originalRecordedAt = row.file_recorded_at ?? row.occurred_at ?? row.sort_at;
  const ref = { type: text(row.entity_type), id: text(row.entity_id) };
  const object = row.object_type && row.object_id ? { type: row.object_type, id: row.object_id } : null;
  const source = sources.read(object ?? ref);
  const date = optionalText(row.display_date);
  const when: CalendarTime = date
    ? { kind: 'allDay', date, endDate: null }
    : { kind: 'timed', startAt: row.occurred_at ?? row.sort_at, endAt: null, timeZone: input.timeZone };
  const currentRevision = Number(row.current_revision ?? row.item_revision);
  return calendarItemSchema.parse({
    id: row.id,
    category: row.category,
    title: source.title,
    sourceType: source.type,
    changes: row.activity_changes
      ? JSON.parse(row.activity_changes)
      : [
          {
            entityType: ref.type,
            operation: row.source === 'activity_correction' ? 'CORRECT' : text(row.operation),
            count: 1,
          },
        ],
    thumbnailAssetId: source.thumbnailAssetId,
    packSync: source.packSync,
    note: (row.activity_count ?? 1) > 1 ? '' : text(row.note),
    operation: (row.activity_count ?? 1) > 1 ? null : text(row.operation),
    entity: { ...ref, available: source.available, navigateTo: source.navigateTo },
    when,
    recordedAt: originalRecordedAt,
    originalRecordedAt,
    updatedAt: row.updated_at ?? originalRecordedAt,
    timeBasis: date ? 'declared' : row.file_recorded_at ? 'observed' : 'recorded',
    revision: row.item_revision,
    invalidated: Boolean(row.invalidated),
    corrected: Boolean(row.group_corrected) || row.item_revision > 0,
    activityCount: row.activity_count ?? 1,
    activitySummary: object
      ? {
          object,
          firstAt: row.first_at ?? null,
          lastAt: row.last_at ?? null,
          categories: JSON.parse(row.activity_categories ?? '[]'),
        }
      : null,
    occurrenceId: row.occurrence_id,
    displayWhen: when,
    historical: (input.timeAxis === 'recorded' || Boolean(input.knownAt)) && row.item_revision !== currentRevision,
  });
}
