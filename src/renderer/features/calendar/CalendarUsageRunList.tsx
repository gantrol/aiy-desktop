import { ArrowUpRightIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { calendarOperationLabel } from '@/renderer/features/calendar/calendarPresentation';
import type { CalendarEntityRef } from '@/shared/contracts/calendar';
import type { CalendarUsageResult, CalendarUsageRunsResult } from '@/shared/calendar-usage';

interface Props {
  runs: CalendarUsageRunsResult['runs'];
  targets: CalendarUsageResult['targets'];
  timeZone: string;
  canOpenEntity(ref: CalendarEntityRef): boolean;
  onOpenEntity(ref: CalendarEntityRef): void;
  onFilterObject(ref: CalendarEntityRef | null): void;
}

function UsageRun({
  run,
  targets,
  timeZone,
  canOpenEntity,
  onOpenEntity,
  onFilterObject,
}: Omit<Props, 'runs'> & {
  run: CalendarUsageRunsResult['runs'][number];
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const number = new Intl.NumberFormat(locale);
  const time = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const token = (value: number | null) => (value === null ? m.unknown : number.format(value));
  const target = targets.find(
    (entry) => entry.target?.type === run.target?.type && entry.target?.id === run.target?.id,
  );
  const destination = target?.available ? target.navigateTo : null;
  const statusLabel = calendarOperationLabel(run.status, m);
  const status = statusLabel === m.activityChange ? run.status : statusLabel;

  return (
    <li className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">
          {m.usageSources[run.source]} · {status}
        </p>
        <span className="text-xs text-muted-foreground">
          {run.usageState === 'MISSING'
            ? m.usageMissing
            : run.usageState === 'PARTIAL'
              ? m.usagePartial
              : m.usageKnownSubtotal}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{m.usageRunId}</dt>
        <dd className="break-all font-mono">{run.runId}</dd>
        <dt className="text-muted-foreground">{m.usageStartedAt}</dt>
        <dd>{time.format(new Date(run.startedAt))}</dd>
        <dt className="text-muted-foreground">{m.requestedModel}</dt>
        <dd className="break-words">{run.requestedModel ?? m.unknown}</dd>
        <dt className="text-muted-foreground">{m.observedModel}</dt>
        <dd className="break-words">{run.observedModel ?? m.unknown}</dd>
        <dt className="text-muted-foreground">{m.usageKnownSubtotal}</dt>
        <dd className="tabular-nums">{token(run.knownTotalTokens)}</dd>
      </dl>
      <div className="mt-3 rounded-md bg-surface-sunken p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{m.usageObject}</span>
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="ghost" onClick={() => onFilterObject(run.target)}>
              {m.usageFilterObject}
            </Button>
            {destination && canOpenEntity(destination) && (
              <Button size="xs" variant="ghost" onClick={() => onOpenEntity(destination)}>
                {m.openSource}
                <ArrowUpRightIcon className="size-3" />
              </Button>
            )}
          </div>
        </div>
        {run.target ? (
          <div className="mt-1 grid gap-1 text-xs">
            {target?.title && <p className="break-words">{target.title}</p>}
            <p className="break-all font-mono text-muted-foreground">
              {run.target.type} · {run.target.id}
            </p>
            {target?.titleBasis === 'CURRENT' && <p className="text-muted-foreground">{m.currentTitle}</p>}
            {target && !target.available && <p className="text-muted-foreground">{m.sourceUnavailable}</p>}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{m.unassignedUsage}</p>
        )}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer py-1 text-muted-foreground">{m.usageDetails}</summary>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">{m.status}</dt>
          <dd>{run.status}</dd>
          <dt className="text-muted-foreground">{m.usageFinishedAt}</dt>
          <dd>{run.finishedAt ? time.format(new Date(run.finishedAt)) : m.unknown}</dd>
          <dt className="text-muted-foreground">{m.usageInputTokens}</dt>
          <dd className="tabular-nums">{token(run.knownInputTokens)}</dd>
          <dt className="text-muted-foreground">{m.usageCachedTokens}</dt>
          <dd className="tabular-nums">{token(run.knownCachedInputTokens)}</dd>
          <dt className="text-muted-foreground">{m.usageOutputTokens}</dt>
          <dd className="tabular-nums">{token(run.knownOutputTokens)}</dd>
          <dt className="text-muted-foreground">{m.usageReasoningTokens}</dt>
          <dd className="tabular-nums">{token(run.knownReasoningOutputTokens)}</dd>
          <dt className="text-muted-foreground">{m.source}</dt>
          <dd className="break-all font-mono">
            {run.originalRun.type} · {run.originalRun.id}
          </dd>
        </dl>
        {run.notes.length > 0 && (
          <ul className="mt-2 grid gap-1 text-muted-foreground">
            {run.notes.map((note) => (
              <li key={note}>{m.usageCoverageNotes[note]}</li>
            ))}
          </ul>
        )}
        {canOpenEntity(run.originalRun) ? (
          <Button className="mt-2" variant="ghost" size="xs" onClick={() => onOpenEntity(run.originalRun)}>
            {m.openSource}
            <ArrowUpRightIcon className="size-3" />
          </Button>
        ) : (
          <p className="mt-2 text-muted-foreground">{m.usageNoDirectRun}</p>
        )}
      </details>
    </li>
  );
}

export function CalendarUsageRunList({ runs, ...props }: Props) {
  return (
    <ul className="grid gap-3">
      {runs.map((run) => (
        <UsageRun key={`${run.source}:${run.runId}`} run={run} {...props} />
      ))}
    </ul>
  );
}
