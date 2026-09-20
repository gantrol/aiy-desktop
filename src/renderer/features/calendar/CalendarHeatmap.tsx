import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { formatCivilDate } from '@/renderer/features/calendar/calendarDates';
import type { CalendarDaySummary, CalendarPreferences } from '@/shared/contracts/calendar';

const levels = [
  'bg-muted',
  'bg-selected-foreground/20',
  'bg-selected-foreground/40',
  'bg-selected-foreground/65',
  'bg-selected-foreground',
];

const cellWidth = 32;
const cellHeight = cellWidth / 1.618;
const columnStep = cellWidth + 4;

export function CalendarHeatmap({
  days,
  selectedDate,
  focusDate,
  navigation,
  onBrowse,
  today,
  summaries,
  preferences,
  loading,
  onSelect,
}: {
  days: string[];
  selectedDate: string;
  focusDate: string;
  navigation: number;
  onBrowse(date: string): void;
  today: string;
  summaries: Map<string, CalendarDaySummary>;
  preferences: CalendarPreferences;
  loading: boolean;
  onSelect(date: string): void;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const scroller = useRef<HTMLDivElement>(null);
  const browsing = useRef(false);
  const previous = useRef<{ start: string; offset: number; focus: string; navigation: number } | null>(null);
  const offset = (new Date(`${days[0]}T12:00:00Z`).getUTCDay() - preferences.weekStartsOn + 7) % 7;
  const columns = Math.ceil((offset + days.length) / 7);
  const months = useMemo(() => days.filter((date) => date.endsWith('-01')), [days]);
  const cells = useMemo(() => {
    const maximum = Math.max(1, ...days.map((date) => summaries.get(date)?.total ?? 0));
    const number = new Intl.NumberFormat(locale);
    const format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'full' });
    return days.map((date) => {
      const summary = summaries.get(date);
      const count = summary?.total ?? 0;
      const level = count ? Math.max(1, Math.ceil(Math.sqrt(count / maximum) * 4)) : 0;
      const label = `${format.format(new Date(`${date}T12:00:00Z`))} · ${summary ? `${m.daySummary} ${number.format(count)}` : m.unknown}`;
      return { date, count, level, label, known: Boolean(summary) };
    });
  }, [days, summaries, m, locale]);

  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root) return;
    browsing.current = false;
    const prior = previous.current;
    if (prior && (prior.start !== days[0] || prior.offset !== offset)) {
      // Preserve the visible week when the bounded strip is moved across a year boundary.
      const dayDelta = (Date.parse(prior.start) - Date.parse(days[0])) / 86_400_000;
      root.scrollLeft += ((dayDelta + offset - prior.offset) / 7) * columnStep;
    }
    if (!prior || prior.focus !== focusDate || prior.navigation !== navigation) {
      const index = days.indexOf(focusDate);
      if (index >= 0) {
        root.scrollTo({
          left: Math.floor((index + offset) / 7) * columnStep + cellWidth / 2 - root.clientWidth / 2,
          behavior:
            prior &&
            prior.navigation !== navigation &&
            prior.start === days[0] &&
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'smooth'
              : 'instant',
        });
      }
    }
    previous.current = { start: days[0], offset, focus: focusDate, navigation };
  }, [focusDate, navigation, days, offset]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let timer: number | undefined;
    function settled() {
      if (!root || !browsing.current) return;
      window.clearTimeout(timer);
      browsing.current = false;
      const column = Math.floor((root.scrollLeft + root.clientWidth / 2) / columnStep);
      onBrowse(days[Math.max(0, Math.min(days.length - 1, column * 7 - offset + 3))]);
    }
    function scrolled() {
      if (!browsing.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(settled, 180);
    }
    function startBrowsing() {
      browsing.current = true;
    }
    function wheel(event: WheelEvent) {
      if (!root || event.ctrlKey) return;
      startBrowsing();
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientWidth : 1;
      root.scrollLeft += event.deltaY * scale;
    }
    root.addEventListener('scroll', scrolled, { passive: true });
    root.addEventListener('scrollend', settled);
    root.addEventListener('wheel', wheel, { passive: false });
    root.addEventListener('pointerdown', startBrowsing, { passive: true });
    root.addEventListener('touchstart', startBrowsing, { passive: true });
    root.addEventListener('keydown', startBrowsing);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener('scroll', scrolled);
      root.removeEventListener('scrollend', settled);
      root.removeEventListener('wheel', wheel);
      root.removeEventListener('pointerdown', startBrowsing);
      root.removeEventListener('touchstart', startBrowsing);
      root.removeEventListener('keydown', startBrowsing);
    };
  }, [days, offset, onBrowse]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? days.length - 1
          : event.key in offsets
            ? Math.max(0, Math.min(days.length - 1, index + offsets[event.key]))
            : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(days[next]);
    scroller.current
      ?.querySelector<HTMLButtonElement>(`[data-heatmap-date="${days[next]}"]`)
      ?.focus({ preventScroll: true });
  }

  return (
    <section aria-label={m.heatmap} aria-busy={loading} className="w-full min-w-0 border-b border-border pb-4">
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
        <div
          className="grid gap-1 pt-6 text-[10px] text-muted-foreground"
          style={{ gridTemplateRows: `repeat(7, ${cellHeight}px)` }}
          aria-hidden="true"
        >
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index} className="flex items-center justify-end">
              {formatCivilDate(days[(index - offset + 7) % 7], locale, { weekday: 'narrow' })}
            </span>
          ))}
        </div>
        <div
          ref={scroller}
          tabIndex={0}
          aria-label={m.heatmap}
          className="min-h-0 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="grid gap-y-2" style={{ width: columns * columnStep - 4 }}>
            <div
              className="grid h-4 gap-1 text-[11px] text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${columns}, ${cellWidth}px)` }}
            >
              {months.map((date) => (
                <span
                  key={date}
                  className="overflow-visible whitespace-nowrap"
                  style={{ gridColumn: Math.floor((days.indexOf(date) + offset) / 7) + 1 }}
                >
                  {formatCivilDate(date, locale, { month: 'short', year: 'numeric' })}
                </span>
              ))}
            </div>
            <div
              className="grid grid-flow-col gap-1"
              style={{
                gridTemplateColumns: `repeat(${columns}, ${cellWidth}px)`,
                gridTemplateRows: `repeat(7, ${cellHeight}px)`,
              }}
            >
              {Array.from({ length: offset }, (_, index) => (
                <span key={`padding-${index}`} />
              ))}
              {cells.map(({ date, count, level, label, known }, index) => {
                return (
                  <Button
                    key={date}
                    variant="ghost"
                    size="icon-sm"
                    data-heatmap-date={date}
                    tabIndex={date === selectedDate ? 0 : -1}
                    aria-label={label}
                    title={label}
                    aria-pressed={date === selectedDate}
                    aria-current={date === today ? 'date' : undefined}
                    onClick={() => onSelect(date)}
                    onKeyDown={(event) => navigate(event, index)}
                    className={cn(
                      'h-full min-h-0 w-full min-w-0 rounded-[2px] p-0 hover:ring-1 hover:ring-inset hover:ring-foreground/50',
                      known ? levels[level] : 'bg-muted/40',
                      date > today && !count && 'border border-dashed border-border bg-transparent',
                      date === today && 'outline outline-1 outline-offset-1 outline-muted-foreground',
                      date === focusDate && 'ring-2 ring-inset ring-foreground',
                    )}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div
        className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground"
        title={m.summaryScope}
      >
        <span className="mr-1">{m.heatmapLess}</span>
        {levels.map((level) => (
          <span key={level} aria-hidden="true" className={cn('size-2.5 rounded-[2px]', level)} />
        ))}
        <span className="ml-1">{m.heatmapMore}</span>
      </div>
    </section>
  );
}
