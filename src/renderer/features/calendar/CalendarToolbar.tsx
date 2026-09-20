import { useState } from 'react';
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, EllipsisIcon, RefreshCwIcon } from 'lucide-react';
import { enUS, zhCN } from 'react-day-picker/locale';
import { Button } from '@/renderer/components/ui/button';
import { Calendar } from '@/renderer/components/ui/calendar';
import { formatCivilDate } from '@/renderer/features/calendar/calendarDates';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CalendarAsOfControl } from '@/renderer/features/calendar/CalendarAsOfControl';
import type { CalendarPreferences } from '@/shared/contracts/calendar';

export function CalendarToolbar({
  preferences,
  selectedDate,
  ready,
  busy,
  knownAt,
  onSelect,
  onChangeYear,
  onToday,
  onRefresh,
  onChange,
  onChangeKnownAt,
}: {
  preferences: CalendarPreferences;
  selectedDate: string;
  ready: boolean;
  busy: boolean;
  knownAt?: string;
  onSelect(date: string): void;
  onChangeYear(delta: number): void;
  onToday(): void;
  onRefresh(): void;
  onChange(patch: Partial<CalendarPreferences>): void;
  onChangeKnownAt(value: string | undefined): void;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickedDate = new Date(`${selectedDate}T12:00:00`);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          <h2 className="mr-2 text-lg font-semibold tabular-nums">{selectedDate.slice(0, 4)}</h2>
          <Button variant="ghost" size="icon-sm" aria-label={m.previousYear} onClick={() => onChangeYear(-1)}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={m.nextYear} onClick={() => onChangeYear(1)}>
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onToday}>
            {m.today}
          </Button>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="ml-2 tabular-nums"
                aria-label={`${m.jumpToDate} · ${selectedDate}`}
              >
                <CalendarDaysIcon className="size-3.5" />
                {formatCivilDate(selectedDate, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={pickedDate}
                defaultMonth={pickedDate}
                locale={locale.startsWith('zh') ? zhCN : enUS}
                weekStartsOn={preferences.weekStartsOn}
                startMonth={new Date(1000, 0)}
                endMonth={new Date(9998, 11)}
                disabled={{ before: new Date(1000, 0, 1), after: new Date(9998, 11, 31) }}
                autoFocus
                onSelect={(date) => {
                  if (!date) return;
                  onSelect(
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
                  );
                  setPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" aria-label={m.refresh} disabled={busy} onClick={onRefresh}>
            <RefreshCwIcon className={cn('size-3.5', busy && 'animate-spin motion-reduce:animate-none')} />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={preferences.timeAxis === 'recorded' ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label={m.moreOptions}
              >
                <EllipsisIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="grid w-80 gap-3">
              <Segmented
                type="single"
                value={preferences.timeAxis}
                aria-label={m.timeAxis}
                disabled={!ready}
                onValueChange={(value) => {
                  if (value === 'effective' || value === 'recorded') onChange({ timeAxis: value });
                }}
              >
                <SegmentedItem value="effective">{m.effectiveAxis}</SegmentedItem>
                <SegmentedItem value="recorded">{m.recordedAxis}</SegmentedItem>
              </Segmented>
              {!knownAt && (
                <CalendarAsOfControl timeZone={preferences.timeZone} disabled={!ready} onChange={onChangeKnownAt} />
              )}
              <Button
                variant={preferences.showUsage ? 'secondary' : 'ghost'}
                size="sm"
                disabled={!ready || Boolean(knownAt)}
                aria-pressed={preferences.showUsage}
                onClick={() => onChange({ showUsage: !preferences.showUsage })}
              >
                {m.usage}
              </Button>
              <span className="text-[11px] text-muted-foreground">{preferences.timeZone}</span>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {knownAt && (
        <CalendarAsOfControl
          key={preferences.timeZone}
          knownAt={knownAt}
          timeZone={preferences.timeZone}
          disabled={!ready}
          onChange={onChangeKnownAt}
        />
      )}
    </>
  );
}
