import { useState } from 'react';
import { CalendarRangeIcon, ChevronDownIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import type { CodexUsageDateRange, CodexUsageRange } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Calendar } from '@/renderer/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  className?: string;
  collapseLabel?: boolean;
  disabled: boolean;
  label?: string;
  range: CodexUsageRange;
  dateRange: CodexUsageDateRange | null;
  onChange(range: CodexUsageRange, dateRange: CodexUsageDateRange | null): void;
}

const presets: Exclude<CodexUsageRange, 'CUSTOM'>[] = [
  'TODAY',
  'LAST_24_HOURS',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'ALL',
];

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day);
}

function dateToKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pickerRange(range: CodexUsageDateRange | null): DateRange | undefined {
  if (!range) return undefined;
  return { from: dateFromKey(range.from), to: dateFromKey(range.to) };
}

function presetCalendarRange(range: Exclude<CodexUsageRange, 'CUSTOM'>): DateRange | undefined {
  if (range === 'ALL') return undefined;
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  const days =
    range === 'TODAY'
      ? 1
      : range === 'LAST_24_HOURS'
        ? 2
        : range === 'LAST_7_DAYS'
          ? 7
          : range === 'LAST_30_DAYS'
            ? 30
            : 90;
  from.setDate(from.getDate() - (days - 1));
  return { from, to };
}

export function formatCodexUsageDateRange(range: CodexUsageDateRange, locale: 'en' | 'zh') {
  const from = dateFromKey(range.from);
  const to = dateFromKey(range.to);
  if (locale === 'zh') {
    const fromText = `${from.getFullYear()}年${from.getMonth() + 1}月${from.getDate()}日`;
    if (range.from === range.to) return fromText;
    const toText =
      from.getFullYear() === to.getFullYear()
        ? `${to.getMonth() + 1}月${to.getDate()}日`
        : `${to.getFullYear()}年${to.getMonth() + 1}月${to.getDate()}日`;
    return `${fromText} – ${toText}`;
  }
  const fullDate = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  if (range.from === range.to) return fullDate.format(from);
  const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  if (from.getFullYear() === to.getFullYear()) {
    return `${monthDay.format(from)} – ${monthDay.format(to)}, ${to.getFullYear()}`;
  }
  return `${fullDate.format(from)} – ${fullDate.format(to)}`;
}

export function CodexUsageDateRangePicker({
  className,
  collapseLabel = false,
  disabled,
  label,
  range,
  dateRange,
  onChange,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexUsageInvestigator;
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange>();
  const [displayMonth, setDisplayMonth] = useState(() => new Date());
  const [draftPreset, setDraftPreset] = useState<CodexUsageRange>(range);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeValid = Boolean(
    draftRange?.from && draftRange.to && draftRange.from <= draftRange.to && draftRange.to <= today,
  );
  const selectionText =
    range === 'CUSTOM' && dateRange ? formatCodexUsageDateRange(dateRange, locale) : l.ranges[range];
  const rangeLabel = label ?? l.rangeLabel;

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      const nextRange = range === 'CUSTOM' ? pickerRange(dateRange) : presetCalendarRange(range);
      setDraftRange(nextRange);
      setDisplayMonth(nextRange?.from ?? new Date());
      setDraftPreset(range);
    }
    setOpen(nextOpen);
  }

  function applyRange() {
    if (draftPreset === 'CUSTOM') {
      if (!rangeValid || !draftRange?.from || !draftRange.to) return;
      onChange('CUSTOM', { from: dateToKey(draftRange.from), to: dateToKey(draftRange.to) });
    } else {
      onChange(draftPreset, null);
    }
    setOpen(false);
  }

  function changePreset(value: string) {
    const nextPreset = value as CodexUsageRange;
    setDraftPreset(nextPreset);
    if (nextPreset === 'CUSTOM') return;
    const nextRange = presetCalendarRange(nextPreset);
    setDraftRange(nextRange);
    setDisplayMonth(nextRange?.from ?? new Date());
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`${rangeLabel}: ${selectionText}`}
          className={cn('min-w-0 max-w-80 justify-start text-left font-normal data-[state=open]:bg-hover', className)}
        >
          <CalendarRangeIcon className="size-4 text-muted-foreground" />
          <span className="flex min-w-0 items-center">
            <span className={cn('shrink-0', collapseLabel && 'hidden @3xl/codex-usage:inline')}>
              {rangeLabel} ·&nbsp;
            </span>
            <span className="truncate">{selectionText}</span>
          </span>
          <ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
      >
        <Segmented
          type="single"
          value={draftPreset}
          aria-label={l.datePicker.presets}
          className="m-3 grid h-auto w-80 shrink-0 grid-cols-3"
          onValueChange={(value) => value && changePreset(value)}
        >
          {presets.map((preset) => (
            <SegmentedItem key={preset} value={preset} className="px-1 text-2xs">
              {l.ranges[preset]}
            </SegmentedItem>
          ))}
          <SegmentedItem value="CUSTOM" className="px-1 text-2xs">
            {l.ranges.CUSTOM}
          </SegmentedItem>
        </Segmented>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t">
          <Calendar
            mode="range"
            locale={locale === 'zh' ? zhCN : enUS}
            month={displayMonth}
            selected={draftRange}
            disabled={{ after: today }}
            showOutsideDays
            onMonthChange={setDisplayMonth}
            onSelect={(nextRange) => {
              setDraftRange(nextRange);
              setDraftPreset('CUSTOM');
            }}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end border-t p-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled || (draftPreset === 'CUSTOM' && !rangeValid)}
            onClick={applyRange}
          >
            {l.datePicker.apply}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
