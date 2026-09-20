import { RefreshCwIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { calendarSelectClass } from '@/renderer/features/calendar/calendarControls';
import { CalendarUsageRunList } from '@/renderer/features/calendar/CalendarUsageRunList';
import { formatCivilDate } from '@/renderer/features/calendar/calendarDates';
import { useCalendarUsageDetails } from '@/renderer/features/calendar/useCalendarUsageDetails';
import { calendarUsageSourceValues, type CalendarUsageResult } from '@/shared/calendar-usage';
import type { CalendarEntityRef, CalendarPreferences } from '@/shared/contracts/calendar';

interface Props {
  spaceId: string;
  date: string;
  timeZone: string;
  source: CalendarPreferences['usageSource'];
  active: boolean;
  dataRevision: number;
  canOpenEntity(ref: CalendarEntityRef): boolean;
  onOpenEntity(ref: CalendarEntityRef): void;
  onClose(): void;
}

const all = '__ALL__';
const modelKey = (model: string | null | undefined) => (model === undefined ? all : JSON.stringify(model));
const targetKey = (target: CalendarEntityRef | null | undefined) =>
  target === undefined ? all : JSON.stringify(target ? [target.type, target.id] : null);

function UsageFilters({ data }: { data: ReturnType<typeof useCalendarUsageDetails> }) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const observedModelsAvailable = Boolean(data.options?.models.some((value) => value.observedModel !== null));
  const models = Array.from(
    new Set(
      (data.options?.models ?? []).map((value) =>
        data.modelAttribution === 'OBSERVED' ? value.observedModel : value.requestedModel,
      ),
    ),
  ).filter((value): value is string => value !== null);
  if (data.model !== null && data.model !== undefined && !models.includes(data.model)) models.push(data.model);
  models.sort((left, right) => left.localeCompare(right, locale));
  const targets = (data.options?.targets ?? []).filter((value) => value.target !== null);
  const selectedTargetMissing =
    data.target && !targets.some((value) => targetKey(value.target) === targetKey(data.target));

  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <legend className="mb-2 text-xs font-medium text-muted-foreground">{m.usageFilters}</legend>
      <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
        {m.usageSource}
        <select
          className={calendarSelectClass}
          value={data.source}
          onChange={(event) => data.changeSource(event.target.value as CalendarPreferences['usageSource'])}
        >
          <option value="all">{m.allSources}</option>
          {calendarUsageSourceValues.map((source) => (
            <option key={source} value={source}>
              {m.usageSources[source]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
        {m.modelAttribution}
        <select
          className={calendarSelectClass}
          value={data.modelAttribution}
          onChange={(event) => data.changeAttribution(event.target.value as 'REQUESTED' | 'OBSERVED')}
        >
          <option value="REQUESTED">{m.requestedModel}</option>
          {observedModelsAvailable && <option value="OBSERVED">{m.observedModel}</option>}
        </select>
      </label>
      <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
        {data.modelAttribution === 'OBSERVED' ? m.observedModel : m.requestedModel}
        <select
          className={calendarSelectClass}
          value={modelKey(data.model)}
          disabled={!data.options}
          onChange={(event) =>
            data.setModel(
              event.target.value === all
                ? undefined
                : event.target.value === 'null'
                  ? null
                  : models.find((value) => modelKey(value) === event.target.value),
            )
          }
        >
          <option value={all}>{m.allModels}</option>
          <option value="null">{m.unknown}</option>
          {models.map((model) => (
            <option key={model} value={modelKey(model)}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
        {m.usageObject}
        <select
          className={calendarSelectClass}
          value={targetKey(data.target)}
          disabled={!data.options}
          onChange={(event) =>
            data.setTarget(
              event.target.value === all
                ? undefined
                : event.target.value === 'null'
                  ? null
                  : targets.find((value) => targetKey(value.target) === event.target.value)?.target,
            )
          }
        >
          <option value={all}>{m.allUsageObjects}</option>
          <option value="null">{m.unassignedUsage}</option>
          {targets.map((value) => (
            <option key={targetKey(value.target)} value={targetKey(value.target)}>
              {value.title || m.sourceUnavailable} · {value.target?.type} · {value.target?.id}
            </option>
          ))}
          {selectedTargetMissing && (
            <option value={targetKey(data.target)}>
              {data.target?.type} · {data.target?.id}
            </option>
          )}
        </select>
      </label>
      {data.options && (data.options.truncated || data.options.targetsTruncated || data.options.groupsTruncated) && (
        <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">{m.usageOptionsPartial}</p>
      )}
    </fieldset>
  );
}

function UsageSummary({ summary }: { summary: CalendarUsageResult }) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const number = new Intl.NumberFormat(locale);
  const totals = summary.totals;
  return (
    <div className="rounded-lg bg-surface-sunken p-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground">{m.metrics.calls}</dt>
        <dd className="text-right tabular-nums">{number.format(totals.runCount)}</dd>
        <dt className="text-muted-foreground">{m.usageKnownSubtotal}</dt>
        <dd className="text-right tabular-nums">
          {totals.knownTotalTokens === null ? m.unknown : number.format(totals.knownTotalTokens)}
        </dd>
        <dt className="text-muted-foreground">{m.usageFailedRuns}</dt>
        <dd className="text-right tabular-nums">{number.format(totals.failedRunCount)}</dd>
        <dt className="text-muted-foreground">{m.usageActiveRuns}</dt>
        <dd className="text-right tabular-nums">{number.format(totals.activeRunCount)}</dd>
        <dt className="text-muted-foreground">{m.usageNotStartedRuns}</dt>
        <dd className="text-right tabular-nums">{number.format(totals.notStartedRunCount)}</dd>
        <dt className="text-muted-foreground">{m.usageMissingRuns}</dt>
        <dd className="text-right tabular-nums">{number.format(totals.usageMissingRunCount)}</dd>
      </dl>
      {summary.truncated && <p className="mt-2 text-xs text-muted-foreground">{m.usageSummaryPartial}</p>}
      {(totals.usagePartialRunCount > 0 || totals.usageMissingRunCount > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">{m.partialTokens}</p>
      )}
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer py-1">{m.coverageDetails}</summary>
        <p className="mt-2">
          {m.usageSourceLimit} · {number.format(summary.coverage.limitPerSource)}
        </p>
        <p className="mt-2">{m.costUnavailable}</p>
        <ul className="mt-2 grid gap-2">
          {summary.coverage.sources.map((source) => (
            <li key={source.source}>
              <p>
                {m.usageSources[source.source]} · {number.format(source.includedRunCount)}
                {source.truncated ? ` · ${m.partial}` : ''}
              </p>
              {source.notes.map((note) => (
                <p key={note} className="mt-1">
                  {m.usageCoverageNotes[note]}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function UsageDetailsContent(props: Props) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const data = useCalendarUsageDetails(props);
  return (
    <Dialog
      open={props.active}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{m.usageDetails}</DialogTitle>
          <DialogDescription>
            {formatCivilDate(props.date, locale, { dateStyle: 'full' })} · {props.timeZone}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {m.usageScope} {m.usageRunStartBasis}
          </p>
          <UsageFilters data={data} />
          {data.error && (
            <p role="alert" className="text-sm text-destructive">
              {data.error === 'stale' ? m.usageRefreshRequired : m.usageFailed}
            </p>
          )}
          {data.loading && (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              {m.loading}
            </p>
          )}
          {data.summary && <UsageSummary summary={data.summary} />}
          {data.page &&
            (data.page.runs.length ? (
              <CalendarUsageRunList
                runs={data.page.runs}
                targets={data.options?.targets ?? []}
                timeZone={props.timeZone}
                canOpenEntity={props.canOpenEntity}
                onOpenEntity={props.onOpenEntity}
                onFilterObject={data.setTarget}
              />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">{m.usageNoMatches}</p>
            ))}
          {data.page?.hasMore && (
            <Button
              variant="outline"
              size="sm"
              disabled={data.loadingMore || data.error === 'stale'}
              onClick={() => void data.loadMore()}
            >
              {data.loadingMore ? m.loading : m.usageLoadMore}
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={data.refresh} disabled={data.loading}>
            <RefreshCwIcon className="size-3.5" />
            {m.refresh}
          </Button>
          <Button variant="ghost" onClick={props.onClose}>
            {m.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CalendarUsageDetails(props: Props) {
  if (!props.active) return null;
  return (
    <UsageDetailsContent key={JSON.stringify([props.spaceId, props.date, props.timeZone, props.source])} {...props} />
  );
}
