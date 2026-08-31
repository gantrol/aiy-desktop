import { useState } from 'react';
import { CalendarRangeIcon, ChevronDownIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import type { CodexVisualizationDateRange } from '@/shared/contracts/codex-visualizations';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Calendar } from '@/renderer/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import type {
  CodexVisualizationThreadDiagramDatePreset,
  CodexVisualizationThreadDiagramDateSelection,
} from '@/renderer/features/extensions/codexVisualizationPreferences';
import { useI18n } from '@/renderer/i18n/useI18n';

type DraftPreset = CodexVisualizationThreadDiagramDatePreset | 'CUSTOM';
type CompleteDateRange = { from: Date; to: Date };

interface Props {
  busy: boolean;
  threadContentAuthorized: boolean;
  selection: CodexVisualizationThreadDiagramDateSelection;
  range: CodexVisualizationDateRange | null;
  artifactCount: number | null;
  onChange(selection: CodexVisualizationThreadDiagramDateSelection): void;
}

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

function pickerRange(range: CodexVisualizationDateRange | null): DateRange | undefined {
  if (!range) return undefined;
  return { from: dateFromKey(range.from), to: dateFromKey(range.to) };
}

function presetRange(preset: CodexVisualizationThreadDiagramDatePreset): CompleteDateRange {
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  if (preset === 'SEVEN_DAYS') from.setDate(from.getDate() - 6);
  if (preset === 'THIRTY_DAYS') from.setDate(from.getDate() - 29);
  return { from, to };
}

function formattedDateRange(range: CodexVisualizationDateRange, locale: 'en' | 'zh') {
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

export function CodexThreadDiagramDateRangePicker({
  busy,
  threadContentAuthorized,
  selection,
  range,
  artifactCount,
  onChange,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexVisualizationDiscovery.threadDiagrams;
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange>();
  const [displayMonth, setDisplayMonth] = useState(() => new Date());
  const [draftPreset, setDraftPreset] = useState<DraftPreset>('CUSTOM');
  const rangeValid = Boolean(draftRange?.from && draftRange.to && draftRange.from <= draftRange.to);
  const selectionText = !threadContentAuthorized
    ? l.permissionRequired
    : selection.kind === 'DISABLED'
      ? l.stopped
      : selection.kind === 'PRESET'
        ? {
            TODAY: l.presets.today,
            SEVEN_DAYS: l.presets.sevenDays,
            THIRTY_DAYS: l.presets.thirtyDays,
          }[selection.preset]
        : formattedDateRange(selection.range, locale);
  const countText =
    threadContentAuthorized && selection.kind !== 'DISABLED' && artifactCount !== null
      ? artifactCount === 0
        ? l.noMatches
        : l.count(artifactCount)
      : null;

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      const nextRange = pickerRange(range);
      setDraftRange(nextRange);
      setDisplayMonth(nextRange?.from ?? new Date());
      setDraftPreset(selection.kind === 'PRESET' ? selection.preset : 'CUSTOM');
    }
    setOpen(nextOpen);
  }

  function applyRange() {
    if (!rangeValid || !draftRange?.from || !draftRange.to) return;
    if (draftPreset === 'CUSTOM') {
      onChange({
        kind: 'CUSTOM',
        range: { from: dateToKey(draftRange.from), to: dateToKey(draftRange.to) },
      });
    } else {
      onChange({ kind: 'PRESET', preset: draftPreset });
    }
    setOpen(false);
  }

  function stopAndClear() {
    setDraftRange(undefined);
    setDraftPreset('CUSTOM');
    onChange({ kind: 'DISABLED' });
    setOpen(false);
  }

  function changePreset(value: string) {
    const nextPreset = value as DraftPreset;
    setDraftPreset(nextPreset);
    if (nextPreset === 'CUSTOM') return;
    const nextRange = presetRange(nextPreset);
    setDraftRange(nextRange);
    setDisplayMonth(nextRange.from);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !threadContentAuthorized}
          aria-label={`${l.label}: ${selectionText}${countText ? `, ${countText}` : ''}`}
          className="min-w-0 max-w-80 justify-start text-left font-normal data-[state=open]:bg-hover"
        >
          <CalendarRangeIcon className="size-4 text-muted-foreground" />
          <span className="truncate">
            {l.label} · {selectionText}
          </span>
          {countText && (
            <Badge variant="secondary" className="px-1.5 py-0 text-2xs font-normal">
              {countText}
            </Badge>
          )}
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
          aria-label={l.presets.label}
          className="m-3 grid h-auto w-72 shrink-0 grid-cols-4"
          onValueChange={(value) => value && changePreset(value)}
        >
          <SegmentedItem value="TODAY" className="px-1 text-2xs">
            {l.presets.today}
          </SegmentedItem>
          <SegmentedItem value="SEVEN_DAYS" className="px-1 text-2xs">
            {l.presets.sevenDays}
          </SegmentedItem>
          <SegmentedItem value="THIRTY_DAYS" className="px-1 text-2xs">
            {l.presets.thirtyDays}
          </SegmentedItem>
          <SegmentedItem value="CUSTOM" className="px-1 text-2xs">
            {l.presets.custom}
          </SegmentedItem>
        </Segmented>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t">
          <Calendar
            mode="range"
            locale={locale === 'zh' ? zhCN : enUS}
            month={displayMonth}
            selected={draftRange}
            showOutsideDays
            onMonthChange={setDisplayMonth}
            onSelect={(nextRange) => {
              setDraftRange(nextRange);
              setDraftPreset('CUSTOM');
            }}
          />
        </div>
        <div className="flex shrink-0 items-center border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || selection.kind === 'DISABLED'}
            onClick={stopAndClear}
          >
            {l.stopAndClear}
          </Button>
          <Button type="button" size="sm" className="ml-auto" disabled={busy || !rangeValid} onClick={applyRange}>
            {l.apply}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
