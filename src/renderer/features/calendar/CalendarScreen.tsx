import { useCallback, useMemo, useState } from 'react';
import { CalendarDaysIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { AppLocation } from '@/renderer/components/app/app-navigation';
import type { BootstrapDto } from '@/shared/contracts';
import type {
  CalendarItem,
  CalendarPreferences,
  CalendarSummaryResult,
  CalendarEntityRef,
} from '@/shared/contracts/calendar';
import {
  dateInTimeZone,
  deviceTimeZone,
  calendarWindowDays,
  calendarWindowStart,
  shiftDate,
  shiftMonth,
} from '@/renderer/features/calendar/calendarDates';
import { calendarSourceLocation } from '@/renderer/features/calendar/calendarNavigation';
import { calendarEntriesByDay } from '@/renderer/features/calendar/calendarProjection';
import { CalendarItemDialog } from '@/renderer/features/calendar/CalendarItemDialog';
import { CalendarDayPanel } from '@/renderer/features/calendar/CalendarDayPanel';
import { CalendarSettings } from '@/renderer/features/calendar/CalendarSettings';
import { useCalendarData } from '@/renderer/features/calendar/useCalendarData';
import { CalendarToolbar } from '@/renderer/features/calendar/CalendarToolbar';
import { CalendarUsageDetails } from '@/renderer/features/calendar/CalendarUsageDetails';
import { CalendarViews } from '@/renderer/features/calendar/CalendarViews';
import { CalendarHeatmap } from '@/renderer/features/calendar/CalendarHeatmap';
import { CalendarDateWheel } from '@/renderer/features/calendar/CalendarDateWheel';

interface Props {
  spaceId: string;
  data: BootstrapDto;
  dataRevision: number;
  active: boolean;
  onOpenLocation(location: AppLocation): void;
  notify(message: string): void;
}

function CalendarPageHeader({
  preferences,
  ready,
  onChange,
  spaceId,
}: {
  preferences: CalendarPreferences;
  ready: boolean;
  onChange(patch: Partial<CalendarPreferences>): void;
  spaceId: string;
}) {
  const { messages } = useI18n();
  const m = messages.calendar;
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 lg:px-7">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CalendarDaysIcon className="size-5 text-muted-foreground" />
          {m.title}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <CalendarViews spaceId={spaceId} preferences={preferences} disabled={!ready} onApply={onChange} />
        <CalendarSettings preferences={preferences} onChange={onChange} disabled={!ready} />
      </div>
    </header>
  );
}

function CalendarCoverage({ result, timeZone }: { result: CalendarSummaryResult | null; timeZone: string }) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  return (
    <>
      {' '}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {result?.coverage.firstRecordedAt
            ? `${m.coverage} · ${new Intl.DateTimeFormat(locale, { timeZone: timeZone, dateStyle: 'medium' }).format(new Date(result.coverage.firstRecordedAt))}`
            : m.systemRecorded}
        </span>
      </div>
      {result && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1">{m.coverageDetails}</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 leading-relaxed">
            {result.coverage.gaps.map((gap) => (
              <li key={gap}>{m.coverageGaps[gap]}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function CalendarStatus({ state, showUsage }: { state: ReturnType<typeof useCalendarData>; showUsage: boolean }) {
  const { messages } = useI18n();
  const m = messages.calendar;
  return (
    <>
      {(state.error || state.summaryError || state.preferenceError) && (
        <p role="alert" className="rounded-lg bg-destructive-surface px-3 py-2 text-sm text-destructive">
          {state.summaryError ? m.summaryFailed : state.error ? m.loadFailed : m.preferencesFailed}
        </p>
      )}
      {showUsage && (state.dayUsage?.truncated || state.dayUsageError) && (
        <p role="status" className="text-xs text-muted-foreground">
          {state.dayUsageError ? m.usageFailed : `* ${m.usageSummaryPartial}`}
        </p>
      )}
    </>
  );
}

function CalendarUsageNavigation({
  data,
  onOpenLocation,
  onClose,
  ...props
}: {
  spaceId: string;
  date: string;
  timeZone: string;
  source: CalendarPreferences['usageSource'];
  active: boolean;
  dataRevision: number;
  data: BootstrapDto;
  onOpenLocation(location: AppLocation): void;
  onClose(): void;
}) {
  const location = (ref: CalendarEntityRef) => calendarSourceLocation({ entity: { ...ref, available: true } }, data);
  return (
    <CalendarUsageDetails
      {...props}
      onClose={onClose}
      canOpenEntity={(ref) => Boolean(location(ref))}
      onOpenEntity={(ref) => {
        const destination = location(ref);
        if (destination) {
          onClose();
          onOpenLocation(destination);
        }
      }}
    />
  );
}

function CalendarWorkspace({ spaceId, data, dataRevision, active, onOpenLocation, notify }: Props) {
  const { messages } = useI18n();
  const m = messages.calendar;
  const [selectedDate, setSelectedDate] = useState(() => dateInTimeZone(new Date(), deviceTimeZone()));
  const [dateNavigation, setDateNavigation] = useState(0);
  const [previewDate, setPreviewDate] = useState(selectedDate);
  const [heatmapStart, setHeatmapStart] = useState(() => calendarWindowStart(selectedDate));
  const browseDate = useCallback((date: string) => {
    setHeatmapStart((start) =>
      date < shiftDate(start, 84) || date > shiftDate(start, 279) ? calendarWindowStart(date) : start,
    );
  }, []);
  const browseHeatmap = useCallback((date: string) => {
    setHeatmapStart(calendarWindowStart(date));
  }, []);
  const preview = useCallback(
    (date: string) => {
      setPreviewDate(date);
      browseDate(date);
    },
    [browseDate],
  );
  const range = useMemo(() => ({ startDate: heatmapStart, endDate: shiftDate(heatmapStart, 363) }), [heatmapStart]);
  const [knownAt, setKnownAt] = useState<string | undefined>();
  const selectDate = useCallback(
    (date: string) => {
      setSelectedDate(date);
      preview(date);
      setDateNavigation((revision) => revision + 1);
    },
    [preview],
  );
  const state = useCalendarData(spaceId, range, selectedDate, active, dataRevision, knownAt);
  const { preferences, updatePreferences, result } = state;
  const visiblePreferences = useMemo(
    () => (knownAt ? { ...preferences, showUsage: false } : preferences),
    [preferences, knownAt],
  );
  const [detail, setDetail] = useState<CalendarItem | null>(null);
  const [showUsageDetails, setShowUsageDetails] = useState(false);
  const days = useMemo(() => calendarWindowDays(heatmapStart), [heatmapStart]);
  const wheelStart = calendarWindowStart(`${selectedDate.slice(0, 7)}-15`);
  const wheelDays = useMemo(() => calendarWindowDays(wheelStart), [wheelStart]);
  const byDay = useMemo(
    () => calendarEntriesByDay(result?.items ?? [], [state.date], preferences.timeZone, preferences.timeAxis),
    [result, state.date, preferences.timeZone, preferences.timeAxis],
  );
  const summaries = useMemo(() => new Map(state.summary?.days.map((day) => [day.date, day]) ?? []), [state.summary]);
  const today = dateInTimeZone(new Date(), preferences.timeZone);
  const dayEntries = byDay.get(state.date) ?? [];
  const sourceLocation = detail ? calendarSourceLocation(detail, data) : null;
  const busy = !state.ready || state.summaryLoading || (!state.summary && !state.summaryError);
  const dayBusy = !result && (!state.ready || state.loading || !state.error);
  function changeYear(delta: number) {
    const next = shiftMonth(selectedDate, delta * 12);
    if (next >= '1000-01-01' && next <= '9998-12-31') selectDate(next);
  }
  function corrected(item: CalendarItem) {
    setDetail(null);
    selectDate(
      preferences.timeAxis === 'recorded'
        ? dateInTimeZone(item.updatedAt, preferences.timeZone)
        : item.when.kind === 'allDay'
          ? item.when.date
          : dateInTimeZone(item.when.startAt, preferences.timeZone),
    );
    state.refresh();
    notify(m.saved);
  }
  function changeKnownAt(value: string | undefined) {
    setKnownAt(value);
    setDetail(null);
    setShowUsageDetails(false);
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background" aria-label={m.title}>
      <CalendarPageHeader
        preferences={preferences}
        ready={state.ready}
        onChange={updatePreferences}
        spaceId={spaceId}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1600px] gap-4 p-4 sm:p-5 lg:p-7">
          <CalendarToolbar
            preferences={visiblePreferences}
            selectedDate={selectedDate}
            ready={state.ready}
            busy={busy}
            onChangeYear={changeYear}
            onSelect={selectDate}
            onToday={() => selectDate(today)}
            onRefresh={state.refresh}
            onChange={updatePreferences}
            knownAt={knownAt}
            onChangeKnownAt={changeKnownAt}
          />
          <CalendarStatus state={state} showUsage={visiblePreferences.showUsage} />
          <CalendarHeatmap
            days={days}
            selectedDate={selectedDate}
            focusDate={previewDate}
            navigation={dateNavigation}
            onBrowse={browseHeatmap}
            today={today}
            preferences={visiblePreferences}
            summaries={summaries}
            loading={busy}
            onSelect={selectDate}
          />
          <div className="grid items-start gap-4 grid-cols-[88px_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
            <CalendarDateWheel
              navigation={dateNavigation}
              days={wheelDays}
              selectedDate={selectedDate}
              today={today}
              summaries={summaries}
              onSelect={selectDate}
              onPreview={preview}
            />
            <CalendarDayPanel
              key={state.date}
              selectedDate={state.date}
              preferences={visiblePreferences}
              readonly={Boolean(knownAt)}
              entries={dayEntries}
              busy={dayBusy}
              refreshing={state.loading && Boolean(result)}
              failed={state.error && !result}
              partial={Boolean(result?.hasMore)}
              loadingMore={state.loadingMore}
              onLoadMore={state.loadMore}
              usageDay={state.dayUsage?.days.find((day) => day.date === state.date)}
              usageError={state.dayUsageError}
              usageLoading={!state.dayUsage && !state.dayUsageError}
              usageTruncated={Boolean(state.dayUsage?.truncated)}
              onOpen={setDetail}
              onUsageDetails={() => setShowUsageDetails(true)}
              updatePreferences={updatePreferences}
              canContinue={(item) => !knownAt && Boolean(calendarSourceLocation(item, data))}
              onContinue={(item) => {
                const destination = calendarSourceLocation(item, data);
                if (destination) onOpenLocation(destination);
              }}
            />
          </div>
          <CalendarCoverage result={state.summary} timeZone={preferences.timeZone} />
        </div>
      </div>
      {detail && (
        <CalendarItemDialog
          key={detail.occurrenceId}
          spaceId={spaceId}
          item={detail}
          timeZone={preferences.timeZone}
          knownAt={knownAt}
          canOpenSource={Boolean(sourceLocation)}
          onOpenSource={() => {
            if (sourceLocation) {
              setDetail(null);
              onOpenLocation(sourceLocation);
            }
          }}
          onClose={() => setDetail(null)}
          onCorrected={corrected}
        />
      )}
      {showUsageDetails && (
        <CalendarUsageNavigation
          spaceId={spaceId}
          date={selectedDate}
          timeZone={preferences.timeZone}
          source={preferences.usageSource}
          active={active}
          dataRevision={dataRevision}
          data={data}
          onOpenLocation={onOpenLocation}
          onClose={() => setShowUsageDetails(false)}
        />
      )}
    </section>
  );
}

export default function CalendarScreen(props: Props) {
  // A new space owns query generations and pending dialog state.
  return <CalendarWorkspace key={props.spaceId} {...props} />;
}
