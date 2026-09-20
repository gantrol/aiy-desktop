import { useMemo } from 'react';
import { SlidersHorizontalIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { calendarSelectClass } from '@/renderer/features/calendar/calendarControls';
import type { CalendarCategory, CalendarPreferences } from '@/shared/contracts/calendar';

export function CalendarSettings({
  preferences,
  disabled,
  onChange,
}: {
  preferences: CalendarPreferences;
  disabled: boolean;
  onChange(patch: Partial<CalendarPreferences>): void;
}) {
  const { messages } = useI18n();
  const m = messages.calendar;
  const zones = useMemo(
    () => [...new Set(['UTC', preferences.timeZone, ...Intl.supportedValuesOf('timeZone')])],
    [preferences.timeZone],
  );
  const toggleCategory = (category: CalendarCategory) =>
    onChange({
      categories: preferences.categories.includes(category)
        ? preferences.categories.filter((value) => value !== category)
        : [...preferences.categories, category],
    });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <SlidersHorizontalIcon className="size-4" />
          {m.customize}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-[70vh] overflow-y-auto">
        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">{m.categoriesLabel}</legend>
            {Object.entries(m.categories).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={preferences.categories.includes(key as CalendarCategory)}
                  onCheckedChange={() => toggleCategory(key as CalendarCategory)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 border-t border-border pt-3">
            <label className="grid gap-1.5 text-xs text-foreground-secondary">
              {m.timeZone}
              <select
                className={calendarSelectClass}
                value={preferences.timeZone}
                onChange={(event) => onChange({ timeZone: event.target.value })}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-foreground-secondary">
              {m.weekStartsOn}
              <select
                className={calendarSelectClass}
                value={preferences.weekStartsOn}
                onChange={(event) => onChange({ weekStartsOn: Number(event.target.value) as 0 | 1 })}
              >
                <option value={1}>{m.monday}</option>
                <option value={0}>{m.sunday}</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-foreground-secondary">
              {m.metric}
              <select
                className={calendarSelectClass}
                value={preferences.usageMetric}
                onChange={(event) =>
                  onChange({ usageMetric: event.target.value as CalendarPreferences['usageMetric'] })
                }
              >
                {Object.entries(m.metrics).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={preferences.showInvalidated}
                disabled={preferences.timeAxis === 'recorded'}
                onCheckedChange={(checked) => onChange({ showInvalidated: checked === true })}
              />
              {m.showInvalidated}
            </label>
            {preferences.timeAxis === 'recorded' && (
              <p className="text-xs text-muted-foreground">{m.recordedAxisIncludesRevisions}</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
