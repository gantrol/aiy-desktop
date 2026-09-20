import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { CalendarDaySummary } from '@/shared/contracts/calendar';

const rowHeight = 48;

export function CalendarDateWheel({
  days,
  navigation,
  selectedDate,
  today,
  summaries,
  onSelect,
  onPreview,
}: {
  days: string[];
  navigation: number;
  selectedDate: string;
  today: string;
  summaries: Map<string, CalendarDaySummary>;
  onSelect(date: string): void;
  onPreview(date: string): void;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const root = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const previousDays = useRef(days);
  const target = useRef<number | null>(null);
  const userScrolling = useRef(false);
  const selectedIndex = Math.max(0, days.indexOf(selectedDate));
  const [center, setCenter] = useState(selectedIndex);
  const labels = useMemo(() => {
    const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
    const weekdayFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' });
    const fullFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'full' });
    return days.map((date) => {
      const value = new Date(`${date}T12:00:00Z`);
      return { date: dateFormat.format(value), weekday: weekdayFormat.format(value), full: fullFormat.format(value) };
    });
  }, [days, locale]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const top = selectedIndex * rowHeight;
    userScrolling.current = false;
    target.current = selectedIndex;
    const animate =
      initialized.current &&
      previousDays.current === days &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    previousDays.current = days;
    initialized.current = true;
    setCenter(selectedIndex);
    if (Math.abs(element.scrollTop - top) < 1) {
      target.current = null;
      return;
    }
    element.scrollTo({ top, behavior: animate ? 'smooth' : 'instant' });
  }, [selectedIndex, days, navigation]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let timer: number | undefined;
    let lastPreview: number | undefined;
    function settled() {
      if (!element) return;
      const index = Math.max(0, Math.min(days.length - 1, Math.round(element.scrollTop / rowHeight)));
      if (target.current !== null && index !== target.current) return;
      target.current = null;
      window.clearTimeout(timer);
      if (!userScrolling.current) return;
      userScrolling.current = false;
      onPreview(days[index]);
      if (days[index] !== selectedDate) onSelect(days[index]);
    }
    function scrolled() {
      if (!element) return;
      const index = Math.max(0, Math.min(days.length - 1, Math.round(element.scrollTop / rowHeight)));
      setCenter(index);
      if (userScrolling.current && lastPreview !== index) {
        lastPreview = index;
        onPreview(days[index]);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(settled, 180);
    }
    function interrupt() {
      // Chromium interrupts native smooth scrolling on wheel / touch input.
      target.current = null;
      userScrolling.current = true;
    }
    element.addEventListener('scroll', scrolled, { passive: true });
    element.addEventListener('scrollend', settled);
    element.addEventListener('wheel', interrupt, { passive: true });
    element.addEventListener('touchstart', interrupt, { passive: true });
    element.addEventListener('pointerdown', interrupt, { passive: true });
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener('scroll', scrolled);
      element.removeEventListener('scrollend', settled);
      element.removeEventListener('wheel', interrupt);
      element.removeEventListener('touchstart', interrupt);
      element.removeEventListener('pointerdown', interrupt);
    };
  }, [days, selectedDate, onSelect, onPreview]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -7, PageDown: 7 };
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? days.length - 1
          : event.key in offsets
            ? Math.max(0, Math.min(days.length - 1, selectedIndex + offsets[event.key]))
            : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(days[next]);
  }

  return (
    <div className="sticky top-0 min-w-0 self-start py-2">
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-36 h-12 border-y border-selected-foreground/25 bg-selected/40"
        />
        <div
          ref={root}
          role="listbox"
          tabIndex={0}
          aria-label={m.dateWheel}
          aria-activedescendant={`calendar-wheel-${selectedDate}`}
          onKeyDown={navigate}
          className="relative h-[336px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-36 outline-none [overflow-anchor:none] [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-ring"
        >
          {days.map((date, index) => {
            const distance = Math.abs(index - center);
            return (
              <Button
                key={date}
                id={`calendar-wheel-${date}`}
                role="option"
                tabIndex={-1}
                variant="ghost"
                aria-selected={date === selectedDate}
                aria-label={labels[index].full}
                aria-current={date === today ? 'date' : undefined}
                onClick={() => onSelect(date)}
                className={cn(
                  'flex h-12 w-full snap-center justify-between gap-1 rounded-none px-2 text-left tabular-nums transition-[opacity,transform,color] duration-150 motion-reduce:transition-none sm:px-4',
                  distance === 0
                    ? 'scale-100 text-selected-foreground'
                    : distance === 1
                      ? 'scale-95 opacity-70'
                      : distance === 2
                        ? 'scale-90 opacity-40'
                        : 'scale-90 opacity-20',
                )}
              >
                <span className={cn('text-base', distance === 0 && 'font-semibold')}>{labels[index].date}</span>
                <span className="hidden text-[11px] sm:inline">{date === today ? m.today : labels[index].weekday}</span>
                {(summaries.get(date)?.total ?? 0) > 0 && (
                  <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-current" />
                )}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
