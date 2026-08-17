import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  Clock3Icon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type {
  GenerationProcessEventHeaderDto,
  GenerationProcessEventPayloadDto,
  GenerationProcessStatus,
  GenerationProcessSummaryDto,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { cn } from '@/renderer/lib/utils';

const EVENT_PAGE_LIMIT = 50;

type Labels = MessageCatalog['creator']['generationRecord']['generationProcess'];
type LoadState = 'IDLE' | 'LOADING' | 'READY' | 'ERROR';
type StateTagTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface StatusPresentation {
  icon: ReactElement;
  label: string;
  tone: StateTagTone;
}

interface ProcessFieldProps {
  label: string;
  children: ReactNode;
  code?: boolean;
}

function ProcessField({ label, children, code = false }: ProcessFieldProps) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 break-words', code && 'break-all font-mono text-[11px]')}>{children}</dd>
    </div>
  );
}

function statusPresentation(status: GenerationProcessStatus, labels: Labels): StatusPresentation {
  switch (status) {
    case 'QUEUED':
      return { icon: <Clock3Icon />, label: labels.statuses.queued, tone: 'neutral' };
    case 'RUNNING':
      return { icon: <LoaderCircleIcon className="animate-spin" />, label: labels.statuses.running, tone: 'info' };
    case 'SUCCEEDED':
      return { icon: <CheckCircle2Icon />, label: labels.statuses.succeeded, tone: 'success' };
    case 'FAILED':
      return { icon: <CircleAlertIcon />, label: labels.statuses.failed, tone: 'danger' };
    case 'CANCELLED':
      return { icon: <BanIcon />, label: labels.statuses.cancelled, tone: 'neutral' };
    case 'INTERRUPTED':
      return { icon: <TriangleAlertIcon />, label: labels.statuses.interrupted, tone: 'warning' };
  }
}

function phaseLabel(phase: string, labels: Labels) {
  const knownPhases: Record<string, string> = {
    QUEUED: labels.phases.queued,
    PREPARING: labels.phases.preparing,
    SUBMITTING: labels.phases.submitting,
    UPLOADING: labels.phases.uploading,
    WAITING_PROVIDER: labels.phases.waitingProvider,
    GENERATING: labels.phases.generating,
    DOWNLOADING: labels.phases.downloading,
    FINALIZING: labels.phases.finalizing,
    SAVING: labels.phases.saving,
    RECOVERING: labels.phases.recovering,
    CANCELLING: labels.phases.cancelling,
    SUCCEEDED: labels.phases.succeeded,
    FAILED: labels.phases.failed,
    CANCELLED: labels.phases.cancelled,
    INTERRUPTED: labels.phases.interrupted,
  };
  return knownPhases[phase] ?? phase;
}

function eventTypeLabel(eventType: string, labels: Labels) {
  const knownEventTypes: Record<string, string> = {
    CREATED: labels.eventTypes.created,
    RETRY_CREATED: labels.eventTypes.retryCreated,
    QUEUED: labels.eventTypes.queued,
    RUNNING: labels.eventTypes.running,
    PHASE_CHANGED: labels.eventTypes.phaseChanged,
    REQUEST_IDENTIFIED: labels.eventTypes.requestIdentified,
    REQUEST_ACCEPTED: labels.eventTypes.requestAccepted,
    REMOTE_OPERATION_ACCEPTED: labels.eventTypes.remoteOperationAccepted,
    CHECKPOINT_SAVED: labels.eventTypes.checkpointSaved,
    SUCCEEDED: labels.eventTypes.succeeded,
    FAILED: labels.eventTypes.failed,
    CANCELLED: labels.eventTypes.cancelled,
    INTERRUPTED: labels.eventTypes.interrupted,
    APPLICATION_CLOSED: labels.eventTypes.applicationClosed,
  };
  return knownEventTypes[eventType] ?? eventType;
}

function unavailableReasonLabel(
  reason: Extract<GenerationProcessEventPayloadDto, { kind: 'UNAVAILABLE' }>['reason'],
  labels: Labels,
) {
  if (reason === 'MALFORMED') return labels.payloadReasons.malformed;
  if (reason === 'OVERSIZED') return labels.payloadReasons.oversized;
  return labels.payloadReasons.unsupported;
}

function booleanLabel(value: boolean | null, labels: Labels) {
  if (value === null) return labels.unknown;
  return value ? labels.yes : labels.no;
}

function EventPayload({ payload, labels }: { payload: GenerationProcessEventPayloadDto; labels: Labels }) {
  if (payload.kind === 'NONE') return null;
  if (payload.kind === 'UNAVAILABLE') {
    return (
      <p className="break-words rounded-md bg-surface-sunken px-2 py-1.5 text-[11px] text-muted-foreground">
        {labels.detailUnavailable} · {unavailableReasonLabel(payload.reason, labels)}
      </p>
    );
  }

  return (
    <dl className="grid min-w-0 gap-2 min-[420px]:grid-cols-2">
      {payload.kind === 'PROVIDER_REQUEST' && (
        <>
          <ProcessField label={labels.provider}>{payload.providerKey ?? labels.notRecorded}</ProcessField>
          <ProcessField label={labels.requestIdRecorded}>
            {booleanLabel(payload.hasProviderRequestId, labels)}
          </ProcessField>
          <ProcessField label={labels.remoteOperationAccepted}>
            {booleanLabel(payload.remoteOperationAccepted, labels)}
          </ProcessField>
        </>
      )}
      {payload.kind === 'FAILURE' && (
        <>
          <ProcessField label={labels.errorCode} code>
            {payload.errorCode ?? labels.notRecorded}
          </ProcessField>
          <ProcessField label={labels.providerCode} code>
            {payload.providerCode ?? labels.notRecorded}
          </ProcessField>
          <ProcessField label={labels.retryable}>{booleanLabel(payload.retryable, labels)}</ProcessField>
        </>
      )}
      {payload.kind === 'OUTPUT' && (
        <>
          <ProcessField label={labels.outputAssetId} code>
            {payload.assetId}
          </ProcessField>
          <ProcessField label={labels.providerOutputIdRecorded}>
            {booleanLabel(payload.hasProviderOutputId, labels)}
          </ProcessField>
        </>
      )}
    </dl>
  );
}

function ProcessEventCard({
  event,
  labels,
  formatTimestamp,
  formatProgress,
}: {
  event: GenerationProcessEventHeaderDto;
  labels: Labels;
  formatTimestamp(value: string): string;
  formatProgress(value: number): string;
}) {
  return (
    <li
      className="grid min-w-0 gap-2 rounded-md border bg-background/70 p-2.5"
      data-generation-process-event={event.sequence}
    >
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="min-w-0 break-words font-medium">{eventTypeLabel(event.eventType, labels)}</strong>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">#{event.sequence}</span>
        <time className="min-w-0 text-[11px] text-muted-foreground min-[420px]:ml-auto" dateTime={event.createdAt}>
          {formatTimestamp(event.createdAt)}
        </time>
      </header>
      {(event.phase || event.progress !== null) && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {event.phase && (
            <span className="max-w-full break-words rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[11px]">
              {phaseLabel(event.phase, labels)}
            </span>
          )}
          {event.progress !== null && (
            <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[11px] tabular-nums">
              {formatProgress(event.progress)}
            </span>
          )}
        </div>
      )}
      {event.statusMessage && <p className="whitespace-pre-wrap break-words leading-relaxed">{event.statusMessage}</p>}
      {event.statusMessageOmitted && <p className="text-[11px] text-muted-foreground">{labels.statusMessageOmitted}</p>}
      <EventPayload payload={event.payload} labels={labels} />
      <dl className="grid min-w-0 gap-2 border-t pt-2 min-[420px]:grid-cols-2">
        <ProcessField label={labels.eventId} code>
          {event.id}
        </ProcessField>
        <ProcessField label={labels.attemptId} code>
          {event.attemptId ?? labels.notRecorded}
        </ProcessField>
      </dl>
    </li>
  );
}

function ProcessSummary({
  summary,
  labels,
  formatTimestamp,
  formatProgress,
}: {
  summary: GenerationProcessSummaryDto;
  labels: Labels;
  formatTimestamp(value: string): string;
  formatProgress(value: number): string;
}) {
  const status = statusPresentation(summary.status, labels);
  return (
    <section className="grid min-w-0 gap-2.5" aria-labelledby={`generation-process-summary-${summary.runId}`}>
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h4 id={`generation-process-summary-${summary.runId}`} className="font-medium">
          {labels.summary}
        </h4>
        <StateTag tone={status.tone} icon={status.icon}>
          {status.label}
        </StateTag>
      </header>
      <dl className="grid min-w-0 gap-2 min-[420px]:grid-cols-2">
        <ProcessField label={labels.phase}>{phaseLabel(summary.phase, labels)}</ProcessField>
        <ProcessField label={labels.progress}>
          {summary.progress === null ? labels.notRecorded : formatProgress(summary.progress)}
        </ProcessField>
        <ProcessField label={labels.provider}>{summary.providerKey ?? labels.notRecorded}</ProcessField>
        <ProcessField label={labels.requestIdRecorded}>
          {booleanLabel(summary.hasProviderRequestId, labels)}
        </ProcessField>
        <ProcessField label={labels.attemptCount}>{summary.attemptCount}</ProcessField>
        <ProcessField label={labels.eventCount}>{summary.eventCount}</ProcessField>
        <ProcessField label={labels.outputCount}>{summary.outputCount}</ProcessField>
        <ProcessField label={labels.latestSequence}>{summary.latestSequence}</ProcessField>
        <ProcessField label={labels.errorCode} code>
          {summary.errorCodeOmitted ? labels.contentOmitted : (summary.errorCode ?? labels.notRecorded)}
        </ProcessField>
        <ProcessField label={labels.statusMessage}>
          {summary.statusMessageOmitted ? labels.contentOmitted : (summary.statusMessage ?? labels.notRecorded)}
        </ProcessField>
        <ProcessField label={labels.createdAt}>{formatTimestamp(summary.createdAt)}</ProcessField>
        <ProcessField label={labels.startedAt}>
          {summary.startedAt ? formatTimestamp(summary.startedAt) : labels.notRecorded}
        </ProcessField>
        <ProcessField label={labels.finishedAt}>
          {summary.finishedAt ? formatTimestamp(summary.finishedAt) : labels.notRecorded}
        </ProcessField>
        <ProcessField label={labels.updatedAt}>{formatTimestamp(summary.updatedAt)}</ProcessField>
        <ProcessField label={labels.runId} code>
          {summary.runId}
        </ProcessField>
        <ProcessField label={labels.jobId} code>
          {summary.jobId}
        </ProcessField>
        <ProcessField label={labels.rootRunId} code>
          {summary.rootRunId}
        </ProcessField>
        <ProcessField label={labels.retryOfRunId} code>
          {summary.retryOfRunId ?? labels.notApplicable}
        </ProcessField>
      </dl>
    </section>
  );
}

export function GenerationProcessDetails({ runId }: { runId: string }) {
  const { locale, messages } = useI18n();
  const labels = messages.creator.generationRecord.generationProcess;
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('IDLE');
  const [summary, setSummary] = useState<GenerationProcessSummaryDto | null>(null);
  const [events, setEvents] = useState<GenerationProcessEventHeaderDto[]>([]);
  const [eventsAvailable, setEventsAvailable] = useState(true);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const requestRevision = useRef(0);
  const initialRequestRunning = useRef(false);

  const timestampFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
    [locale],
  );
  const progressFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  );
  const formatTimestamp = useCallback(
    (value: string) => {
      const timestamp = new Date(value);
      return Number.isNaN(timestamp.valueOf()) ? value : timestampFormatter.format(timestamp);
    },
    [timestampFormatter],
  );
  const formatProgress = useCallback((value: number) => progressFormatter.format(value), [progressFormatter]);

  useEffect(() => {
    requestRevision.current += 1;
    initialRequestRunning.current = false;
    setOpen(false);
    setLoadState('IDLE');
    setSummary(null);
    setEvents([]);
    setEventsAvailable(true);
    setNextCursor(null);
    setHasMore(false);
    setLoadingMore(false);
    setLoadMoreFailed(false);
    return () => {
      requestRevision.current += 1;
    };
  }, [runId]);

  const loadInitial = useCallback(async () => {
    if (initialRequestRunning.current) return;
    initialRequestRunning.current = true;
    const revision = requestRevision.current;
    setLoadState('LOADING');
    setLoadMoreFailed(false);
    try {
      const [nextSummary, page] = await Promise.all([
        window.desktopApi.generationProcessSummary(runId),
        window.desktopApi.generationProcessEvents({ runId, limit: EVENT_PAGE_LIMIT }),
      ]);
      if (requestRevision.current !== revision) return;
      setSummary(nextSummary);
      setEvents(page?.items ?? []);
      setEventsAvailable(page !== null);
      setNextCursor(page?.nextCursor ?? null);
      setHasMore(page?.hasMore ?? false);
      setLoadState('READY');
    } catch {
      if (requestRevision.current === revision) setLoadState('ERROR');
    } finally {
      if (requestRevision.current === revision) initialRequestRunning.current = false;
    }
  }, [runId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || nextCursor === null) return;
    const revision = requestRevision.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await window.desktopApi.generationProcessEvents({
        runId,
        afterSequence: nextCursor,
        limit: EVENT_PAGE_LIMIT,
      });
      if (requestRevision.current !== revision) return;
      if (!page) {
        setEventsAvailable(false);
        setHasMore(false);
        return;
      }
      setEvents((current) => {
        const bySequence = new Map(current.map((event) => [event.sequence, event]));
        for (const event of page.items) bySequence.set(event.sequence, event);
        return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      if (requestRevision.current === revision) setLoadMoreFailed(true);
    } finally {
      if (requestRevision.current === revision) setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, runId]);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && (loadState === 'IDLE' || loadState === 'ERROR')) void loadInitial();
  }

  const loadedStatus = summary ? statusPresentation(summary.status, labels) : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={changeOpen}
      className="min-w-0 overflow-hidden rounded-md border bg-background/70"
      data-generation-process={runId}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full min-w-0 cursor-pointer flex-wrap items-center gap-2 px-2.5 py-2 text-left outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={open}
        >
          <ChevronRightIcon
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          <span className="min-w-0 flex-1 break-words font-medium">{labels.title}</span>
          {loadedStatus && (
            <StateTag tone={loadedStatus.tone} icon={loadedStatus.icon}>
              {loadedStatus.label}
            </StateTag>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid min-w-0 gap-4 border-t p-2.5 min-[420px]:p-3">
          {loadState === 'LOADING' && (
            <div role="status" className="flex min-h-16 items-center justify-center gap-2 text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              {labels.loading}
            </div>
          )}
          {loadState === 'ERROR' && (
            <div role="alert" className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 break-words text-destructive">{labels.loadFailed}</p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal py-2"
                onClick={() => void loadInitial()}
              >
                {labels.retry}
              </Button>
            </div>
          )}
          {loadState === 'READY' && !summary && (
            <p className="break-words text-muted-foreground">{labels.unavailable}</p>
          )}
          {loadState === 'READY' && summary && (
            <>
              <ProcessSummary
                summary={summary}
                labels={labels}
                formatTimestamp={formatTimestamp}
                formatProgress={formatProgress}
              />
              <section className="grid min-w-0 gap-2.5" aria-labelledby={`generation-process-events-${runId}`}>
                <header className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <h4 id={`generation-process-events-${runId}`} className="font-medium">
                    {labels.timeline}
                  </h4>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{summary.eventCount}</span>
                </header>
                {!eventsAvailable && <p className="text-muted-foreground">{labels.timelineUnavailable}</p>}
                {eventsAvailable && events.length === 0 && <p className="text-muted-foreground">{labels.noEvents}</p>}
                {eventsAvailable && events.length > 0 && (
                  <ol className="grid min-w-0 gap-2">
                    {events.map((event) => (
                      <ProcessEventCard
                        key={event.id}
                        event={event}
                        labels={labels}
                        formatTimestamp={formatTimestamp}
                        formatProgress={formatProgress}
                      />
                    ))}
                  </ol>
                )}
                {loadMoreFailed && (
                  <p role="alert" className="break-words text-destructive">
                    {labels.loadMoreFailed}
                  </p>
                )}
                {eventsAvailable && hasMore && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 h-auto w-full whitespace-normal py-2"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore && <LoaderCircleIcon className="size-4 animate-spin" />}
                    {loadingMore ? labels.loadingMore : loadMoreFailed ? labels.retry : labels.loadMore}
                  </Button>
                )}
              </section>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
