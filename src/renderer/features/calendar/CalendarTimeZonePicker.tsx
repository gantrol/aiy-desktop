import { useMemo, useState } from 'react';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Combobox } from '@/renderer/components/ui/combobox';
import { useI18n } from '@/renderer/i18n/useI18n';
import { deviceTimeZone } from '@/renderer/features/calendar/calendarDates';
import { calendarTimeZoneLabel, calendarTimeZoneOptions } from '@/renderer/features/calendar/calendarTimeZones';
import type { CalendarPreferences } from '@/shared/contracts/calendar';

export function CalendarTimeZonePicker({
  preferences,
  onChange,
}: {
  preferences: CalendarPreferences;
  onChange(patch: Partial<CalendarPreferences>): void;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const [open, setOpen] = useState(false);
  const system = deviceTimeZone();
  const options = useMemo(
    () =>
      open
        ? calendarTimeZoneOptions(preferences.timeZone, system, locale, m)
        : [{ value: preferences.timeZone, label: calendarTimeZoneLabel(preferences.timeZone, m) }],
    [open, preferences.timeZone, system, locale, m],
  );
  return (
    <div className="grid gap-2">
      <span className="text-xs text-foreground-secondary">{m.timeZone}</span>
      <Combobox
        value={preferences.timeZone}
        options={options}
        onOpenChange={setOpen}
        onValueChange={(timeZone) => onChange({ timeZone, followSystemTimeZone: false })}
        ariaLabel={m.timeZone}
        placeholder={m.timeZone}
        searchPlaceholder={m.searchTimeZones}
        emptyText={m.noTimeZones}
        className="w-full min-w-0 text-xs"
        contentClassName="w-96 max-w-[calc(100vw-2rem)]"
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={preferences.followSystemTimeZone === true}
          onCheckedChange={(checked) => onChange({ followSystemTimeZone: checked === true })}
        />
        {m.followSystemTimeZone}
      </label>
    </div>
  );
}
