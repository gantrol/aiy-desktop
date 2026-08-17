import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3Icon, LoaderCircleIcon, SearchIcon, WaypointsIcon } from 'lucide-react';
import type {
  BootstrapDto,
  GenerationProcessEventHeaderDto,
  GenerationProcessSummaryDto,
  Locale,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { AiActivityRecord } from '@/renderer/features/ai-center/activityProjection';
import { activityStatusFilter } from '@/renderer/features/ai-center/activityProjection';
import {
  projectAiActivityTrace,
  type AiActivityTraceEntry,
  type AiActivityTraceLane,
} from '@/renderer/features/ai-center/activityTraceProjection';

const PROCESS_EVENT_PAGE_LIMIT = 100;

type LoadState = 'IDLE' | 'LOADING' | 'READY' | 'ERROR';

interface Props {
  record: AiActivityRecord;
  data: BootstrapDto;
  locale: Locale;
}

interface TimelineBounds {
  start: number;
  end: number;
  duration: number;
}

function validTimestamp(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timelineBounds(entries: AiActivityTraceEntry[]): TimelineBounds | null {
  const timestamps = entries.flatMap((entry) =>
    [validTimestamp(entry.startedAt), validTimestamp(entry.endedAt)].filter((value): value is number => value !== null),
  );
  if (timestamps.length === 0) return null;
  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps);
  return { start, end, duration: Math.max(1, end - start) };
}

function formatDuration(milliseconds: number, locale: Locale) {
  const absolute = Math.max(0, milliseconds);
  if (absolute < 1_000) {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'millisecond', unitDisplay: 'short' }).format(
      Math.round(absolute),
    );
  }
  if (absolute < 60_000) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'short',
      maximumFractionDigits: absolute < 10_000 ? 1 : 0,
    }).format(absolute / 1_000);
  }
  if (absolute < 3_600_000) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(absolute / 60_000);
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(absolute / 3_600_000);
}

function laneClassName(lane: AiActivityTraceLane) {
  if (lane === 'MODEL') return 'bg-selected text-selected-foreground';
  if (lane === 'PROCESS') return 'bg-info-surface text-info';
  return 'bg-surface-sunken text-foreground-secondary';
}

function timelineBarClassName(lane: AiActivityTraceLane, selected: boolean) {
  return cn(
    'absolute top-1/2 h-3 -translate-y-1/2 rounded-sm opacity-80 outline-none transition-[height,opacity,box-shadow] hover:h-4 hover:opacity-100 focus-visible:h-4 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
    lane === 'INPUT' && 'bg-muted-foreground',
    lane === 'MODEL' && 'bg-selected-foreground',
    lane === 'PROCESS' && 'bg-info',
    selected && 'h-4 opacity-100 ring-2 ring-foreground/30',
  );
}

function laneLabel(lane: AiActivityTraceLane, labels: ReturnType<typeof useI18n>['messages']['aiCenter']['trace']) {
  if (lane === 'INPUT') return labels.lanes.input;
  if (lane === 'MODEL') return labels.lanes.model;
  return labels.lanes.process;
}

function TraceTimeline({
  entries,
  locale,
  actualDuration,
  selectedId,
  onSelect,
}: {
  entries: AiActivityTraceEntry[];
  locale: Locale;
  actualDuration: boolean;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const labels = useI18n().messages.aiCenter.trace;
  const bounds = timelineBounds(entries);
  const sequenceIndex = new Map(entries.map((entry, index) => [entry.id, index]));
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [locale],
  );
  if (entries.length === 0 || (actualDuration && !bounds)) return null;

  return (
    <section className="overflow-hidden rounded-md border bg-background" aria-label={labels.ariaLabel}>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)]">
        {(['INPUT', 'MODEL', 'PROCESS'] as const).map((lane) => (
          <div key={lane} className="contents">
            <div className="flex h-8 items-center border-b bg-surface-sunken/45 px-2 text-2xs text-muted-foreground last:border-b-0">
              {laneLabel(lane, labels)}
            </div>
            <div className="relative h-8 border-b bg-surface/50 px-1 last:border-b-0">
              {entries
                .filter((entry) => entry.lane === lane)
                .map((entry) => {
                  const start = validTimestamp(entry.startedAt);
                  const end = validTimestamp(entry.endedAt);
                  if (actualDuration && (start === null || !bounds)) return null;
                  const index = sequenceIndex.get(entry.id) ?? 0;
                  let left = (index / entries.length) * 100;
                  let rawWidth = Math.max(0.8, 100 / entries.length - 0.3);
                  if (actualDuration && start !== null && bounds) {
                    left = Math.min(99.2, Math.max(0, ((start - bounds.start) / bounds.duration) * 100));
                    rawWidth =
                      entry.point || end === null ? 0.8 : ((Math.max(start, end) - start) / bounds.duration) * 100;
                  }
                  const width = Math.max(0.8, Math.min(100 - left, rawWidth));
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={timelineBarClassName(lane, selectedId === entry.id)}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      aria-label={`${laneLabel(lane, labels)} · ${entry.label}`}
                      onClick={() => onSelect(entry.id)}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      {actualDuration && bounds && (
        <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-t px-2 py-1.5 text-2xs tabular-nums text-muted-foreground">
          <time dateTime={new Date(bounds.start).toISOString()}>{timeFormatter.format(bounds.start)}</time>
          <span className="text-center">{formatDuration(bounds.end - bounds.start, locale)}</span>
          <time dateTime={new Date(bounds.end).toISOString()}>{timeFormatter.format(bounds.end)}</time>
        </div>
      )}
    </section>
  );
}

function TraceLedger({
  entries,
  locale,
  selectedId,
  onSelect,
}: {
  entries: AiActivityTraceEntry[];
  locale: Locale;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const labels = useI18n().messages.aiCenter.trace;
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [locale],
  );
  return (
    <ol className="divide-y overflow-hidden rounded-md border bg-background">
      {entries.map((entry) => {
        const start = validTimestamp(entry.startedAt);
        const end = validTimestamp(entry.endedAt);
        const duration = start !== null && end !== null && end >= start ? end - start : null;
        return (
          <li key={entry.id} id={`ai-activity-trace-${entry.id}`}>
            <button
              type="button"
              className={cn(
                'grid w-full min-w-0 grid-cols-[2.25rem_auto_minmax(0,1fr)_auto] items-start gap-2.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selectedId === entry.id && 'bg-selected/55',
              )}
              onClick={() => onSelect(entry.id)}
            >
              <span className="pt-0.5 font-mono text-2xs tabular-nums text-muted-foreground">#{entry.sequence}</span>
              <Badge variant="secondary" className={cn('border-0', laneClassName(entry.lane))}>
                {laneLabel(entry.lane, labels)}
              </Badge>
              <span className="min-w-0">
                <strong className="block truncate text-xs font-medium">{entry.label}</strong>
                {entry.details.length > 0 && (
                  <span className="mt-1 block max-h-10 overflow-hidden break-words text-2xs leading-relaxed text-foreground-secondary">
                    {entry.details.join(' · ')}
                  </span>
                )}
              </span>
              <span className="grid justify-items-end gap-0.5 whitespace-nowrap text-2xs tabular-nums text-muted-foreground">
                {start === null ? entry.startedAt : timeFormatter.format(start)}
                {duration !== null && duration > 0 && <span>{formatDuration(duration, locale)}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function AiActivityTrace({ record, data, locale }: Props) {
  const labels = useI18n().messages.aiCenter;
  const runId = record.kind === 'GENERATION' ? record.run.id : null;
  const running = activityStatusFilter(record) === 'RUNNING';
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [actualDuration, setActualDuration] = useState(true);
  const [callsOnly, setCallsOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('IDLE');
  const [processSummary, setProcessSummary] = useState<GenerationProcessSummaryDto | null>(null);
  const [processEvents, setProcessEvents] = useState<GenerationProcessEventHeaderDto[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [processRevision, setProcessRevision] = useState(0);
  const processRequestRevision = useRef(0);

  useEffect(() => {
    setSelectedId(null);
  }, [record.id]);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = globalThis.setInterval(() => setNow(Date.now()), 1_000);
    return () => globalThis.clearInterval(interval);
  }, [running]);

  useEffect(() => {
    if (!runId) return;
    return window.desktopApi.onGenerationChanged((event) => {
      if (event.runId === runId) setProcessRevision((current) => current + 1);
    });
  }, [runId]);

  useEffect(() => {
    const requestRevision = processRequestRevision.current + 1;
    processRequestRevision.current = requestRevision;
    setProcessSummary(null);
    setProcessEvents([]);
    setNextCursor(null);
    setHasMore(false);
    setLoadingMore(false);
    setLoadMoreFailed(false);
    if (!runId) {
      setLoadState('IDLE');
      return;
    }
    setLoadState('LOADING');
    void Promise.all([
      window.desktopApi.generationProcessSummary(runId),
      window.desktopApi.generationProcessEvents({ runId, limit: PROCESS_EVENT_PAGE_LIMIT }),
    ])
      .then(([summary, page]) => {
        if (processRequestRevision.current !== requestRevision) return;
        setProcessSummary(summary);
        setProcessEvents(page?.items ?? []);
        setNextCursor(page?.nextCursor ?? null);
        setHasMore(page?.hasMore ?? false);
        setLoadState('READY');
      })
      .catch(() => {
        if (processRequestRevision.current === requestRevision) setLoadState('ERROR');
      });
    return () => {
      if (processRequestRevision.current === requestRevision) processRequestRevision.current += 1;
    };
  }, [processRevision, runId]);

  const projection = useMemo(
    () => projectAiActivityTrace(record, data, processEvents, processSummary, labels, now),
    [data, labels, now, processEvents, processSummary, record],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filteredEntries = useMemo(
    () =>
      projection.entries.filter((entry) => {
        if (callsOnly && !entry.call) return false;
        if (!normalizedQuery) return true;
        return [entry.label, ...entry.details, entry.lane]
          .join('\n')
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery);
      }),
    [callsOnly, locale, normalizedQuery, projection.entries],
  );

  async function loadMore() {
    if (!runId || nextCursor === null || loadingMore) return;
    const requestRevision = processRequestRevision.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await window.desktopApi.generationProcessEvents({
        runId,
        afterSequence: nextCursor,
        limit: PROCESS_EVENT_PAGE_LIMIT,
      });
      if (processRequestRevision.current !== requestRevision) return;
      if (!page) {
        setHasMore(false);
        return;
      }
      setProcessEvents((current) => {
        const bySequence = new Map(current.map((event) => [event.sequence, event]));
        for (const event of page.items) bySequence.set(event.sequence, event);
        return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      if (processRequestRevision.current === requestRevision) setLoadMoreFailed(true);
    } finally {
      if (processRequestRevision.current === requestRevision) setLoadingMore(false);
    }
  }

  function selectEntry(id: string) {
    setSelectedId(id);
    globalThis.requestAnimationFrame(() => {
      document.getElementById(`ai-activity-trace-${id}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  return (
    <section className="grid min-w-0 gap-4" data-ai-activity-trace={record.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={actualDuration ? 'secondary' : 'ghost'}
          size="xs"
          aria-label={actualDuration ? labels.trace.useEqualWidth : labels.trace.useActualDuration}
          aria-pressed={actualDuration}
          title={actualDuration ? labels.trace.useEqualWidth : labels.trace.useActualDuration}
          onClick={() => setActualDuration((current) => !current)}
        >
          <Clock3Icon className="size-3.5" />
          {labels.trace.duration}
        </Button>
        <Button
          type="button"
          variant={callsOnly ? 'secondary' : 'ghost'}
          size="xs"
          aria-label={callsOnly ? labels.trace.showAllEvents : labels.trace.showCallsOnly}
          aria-pressed={callsOnly}
          title={callsOnly ? labels.trace.showAllEvents : labels.trace.showCallsOnly}
          onClick={() => setCallsOnly((current) => !current)}
        >
          <WaypointsIcon className="size-3.5" />
          {labels.trace.calls}
        </Button>
        <Badge variant="outline" className="ml-auto">
          {projection.resolution === 'EVENTS' ? labels.trace.detailed : labels.trace.summary}
        </Badge>
        <span className="text-2xs tabular-nums text-muted-foreground">
          {labels.trace.eventCount(filteredEntries.length)}
        </span>
        <div className="relative min-w-40 flex-1 sm:max-w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            className="h-8 pl-8 text-xs"
            aria-label={labels.trace.search}
            placeholder={labels.trace.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {loadState === 'LOADING' && (
        <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {labels.trace.loading}
        </div>
      )}
      {loadState === 'ERROR' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs text-destructive">
          <span>{labels.trace.loadFailed}</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setProcessRevision((current) => current + 1)}
          >
            {labels.trace.retry}
          </Button>
        </div>
      )}

      {filteredEntries.length > 0 && (
        <TraceTimeline
          entries={filteredEntries}
          locale={locale}
          actualDuration={actualDuration}
          selectedId={selectedId}
          onSelect={selectEntry}
        />
      )}

      {filteredEntries.length > 0 ? (
        <TraceLedger entries={filteredEntries} locale={locale} selectedId={selectedId} onSelect={selectEntry} />
      ) : (
        <p className="rounded-md border border-dashed p-5 text-center text-xs text-muted-foreground">
          {projection.entries.length === 0 ? labels.trace.noEvents : labels.trace.noMatches}
        </p>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {loadingMore ? labels.trace.loadingMore : labels.trace.loadMore}
          </Button>
        </div>
      )}
      {loadMoreFailed && <p className="text-center text-xs text-destructive">{labels.trace.loadMoreFailed}</p>}
    </section>
  );
}
