import { useState } from 'react';
import './CalendarDayPanel.css';
import { ArrowUpRightIcon, ChartNoAxesCombinedIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { formatCivilDate } from '@/renderer/features/calendar/calendarDates';
import {
  calendarItemTitle,
  calendarActivityContext,
  calendarActivityTime,
  calendarChangePreview,
} from '@/renderer/features/calendar/calendarPresentation';
import { calendarSelectClass } from '@/renderer/features/calendar/calendarControls';
import type { CalendarItem, CalendarPreferences } from '@/shared/contracts/calendar';
import type { CalendarUsageDay } from '@/shared/calendar-usage';

function DayLoading() {
  const { messages } = useI18n();
  return (
    <div role="status" aria-label={messages.calendar.loading} className="grid gap-5 py-3">
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="grid gap-2">
          <Skeleton className="h-4 w-3/4 max-w-64 animate-none rounded-sm" />
          <Skeleton className="h-3 w-24 animate-none rounded-sm" />
        </div>
      ))}
    </div>
  );
}

function DayItem({
  item,
  timeZone,
  onOpen,
  canContinue,
  onContinue,
}: {
  item: CalendarItem;
  timeZone: string;
  onOpen(): void;
  canContinue: boolean;
  onContinue(): void;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const context = calendarActivityContext(item, m);
  return (
    <div className="group flex min-w-0 items-center gap-2 border-b border-border/50 last:border-b-0">
      <Button
        type="button"
        variant="ghost"
        onClick={onOpen}
        className={cn(
          'h-auto min-w-0 flex-1 justify-start gap-3 rounded-none px-1 py-3 text-left whitespace-normal',
          item.invalidated && 'opacity-50',
        )}
      >
        {item.thumbnailAssetId ? (
          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
            <AssetThumbnail
              asset={{ id: item.thumbnailAssetId }}
              size={96}
              alt=""
              className="size-full object-contain"
              errorClassName="size-5"
            />
          </span>
        ) : (
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
        )}
        <span className="grid min-w-0 flex-1 gap-1">
          <span
            className={cn('line-clamp-2 text-sm font-medium leading-snug', item.invalidated && 'line-through')}
            title={calendarItemTitle(item, m)}
          >
            {calendarItemTitle(item, m)}
          </span>
          <span className="text-[11px] text-muted-foreground" title={context}>
            {calendarActivityTime(item, locale, timeZone, m, 'latest')}
            {item.corrected ? ` · ${m.corrected}` : ''}
            {item.invalidated ? ` · ${m.invalidated}` : ''}
          </span>
          {item.activityCount > 1 && item.changes.length > 0 && (
            <span className="line-clamp-2 text-xs text-muted-foreground">{calendarChangePreview(item, m)}</span>
          )}
        </span>
      </Button>
      {canContinue && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onContinue}
          aria-label={`${m.continueItem} · ${calendarItemTitle(item, m)}`}
          className="shrink-0 text-muted-foreground"
        >
          {m.continueItem}
          <ArrowUpRightIcon className="size-3" />
        </Button>
      )}
    </div>
  );
}

function DayUsage({
  value,
  metric,
  failed,
  loading,
  partial,
}: {
  value: CalendarUsageDay | undefined;
  metric: CalendarPreferences['usageMetric'];
  failed: boolean;
  loading: boolean;
  partial: boolean;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const number = new Intl.NumberFormat(locale);
  if (failed) return <p className="text-xs text-muted-foreground">{m.usageFailed}</p>;
  if (loading) return <DayLoading />;
  if (!value) return <p className="text-xs text-muted-foreground">{partial ? m.partial : m.noUsage}</p>;
  const primary = metric === 'calls' ? value.runCount : metric === 'tokens' ? value.knownTotalTokens : null;
  return (
    <div className="grid gap-3">
      <div>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">
          {primary === null ? '—' : number.format(primary)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{m.metrics[metric]}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{m.metrics.calls}</dt>
        <dd className="text-right tabular-nums">{number.format(value.runCount)}</dd>
        <dt className="text-muted-foreground">{m.metrics.tokens}</dt>
        <dd className="text-right tabular-nums">
          {value.knownTotalTokens === null ? m.unknown : number.format(value.knownTotalTokens)}
        </dd>
      </dl>
      {(value.usageMissingRunCount > 0 || value.usagePartialRunCount > 0) && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{m.partialTokens}</p>
      )}
      {metric === 'cost' && <p className="text-xs text-muted-foreground">{m.costUnavailable}</p>}
    </div>
  );
}

interface Props {
  readonly?: boolean;
  selectedDate: string;
  preferences: CalendarPreferences;
  entries: CalendarItem[];
  busy: boolean;
  refreshing?: boolean;
  failed: boolean;
  partial: boolean;
  loadingMore: boolean;
  onLoadMore(): Promise<void>;
  usageDay: CalendarUsageDay | undefined;
  usageError: boolean;
  usageLoading: boolean;
  usageTruncated: boolean;
  onOpen(item: CalendarItem): void;
  onUsageDetails(): void;
  canContinue(item: CalendarItem): boolean;
  onContinue(item: CalendarItem): void;
  updatePreferences(patch: Partial<CalendarPreferences>): void;
}

export function CalendarDayPanel({
  readonly = false,
  selectedDate,
  preferences,
  entries,
  busy,
  refreshing = false,
  failed,
  partial,
  loadingMore,
  onLoadMore,
  usageDay,
  usageError,
  usageLoading,
  usageTruncated,
  onOpen,
  onUsageDetails,
  updatePreferences,
  canContinue,
  onContinue,
}: Props) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, 8);
  return (
    <aside
      tabIndex={-1}
      className="min-h-[336px] min-w-0 border-l border-border py-2 pl-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:pl-6"
      aria-label={formatCivilDate(selectedDate, locale, { dateStyle: 'full' })}
      aria-busy={busy || refreshing}
    >
      <div className="mb-5">
        <p className="text-xs text-muted-foreground">{formatCivilDate(selectedDate, locale, { weekday: 'long' })}</p>
        <h3 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
          {formatCivilDate(selectedDate, locale, { month: 'long', day: 'numeric' })}
          {refreshing && (
            <span role="status" aria-label={m.loading} className="animate-[calendar-loading-show_0s_150ms_both]">
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-3.5 text-muted-foreground motion-safe:animate-spin"
              />
            </span>
          )}
        </h3>
      </div>
      {busy ? (
        <DayLoading />
      ) : failed ? (
        <p role="alert" className="py-5 text-xs text-destructive">
          {m.loadFailed}
        </p>
      ) : (
        <div className="grid gap-5" inert={refreshing}>
          <div>
            {visible.map((item) => (
              <DayItem
                key={item.occurrenceId}
                item={item}
                timeZone={preferences.timeZone}
                onOpen={() => onOpen(item)}
                canContinue={canContinue(item)}
                onContinue={() => onContinue(item)}
              />
            ))}
            {!entries.length && <p className="px-2 py-2 text-xs text-muted-foreground">{m.noItems}</p>}
            {!expanded && entries.length > 8 && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setExpanded(true)}>
                {m.showDayEntries.replace('{count}', new Intl.NumberFormat(locale).format(entries.length - 8))}
              </Button>
            )}
            {partial && (expanded || entries.length <= 8) && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={loadingMore}
                onClick={() => void onLoadMore()}
              >
                {loadingMore ? m.loading : m.loadMore}
              </Button>
            )}
          </div>
          {readonly && preferences.showUsage && <p className="text-xs text-muted-foreground">{m.asOfUsage}</p>}
          {!readonly && preferences.showUsage && (
            <section aria-label={m.usage} className="border-t border-border pt-4">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ChartNoAxesCombinedIcon className="size-3.5" />
                {m.usage}
              </h4>
              <label className="mb-3 grid gap-1.5 text-xs text-foreground-secondary">
                {m.usageSource}
                <select
                  className={calendarSelectClass}
                  value={preferences.usageSource}
                  onChange={(event) =>
                    updatePreferences({
                      usageSource: event.target.value as CalendarPreferences['usageSource'],
                    })
                  }
                >
                  <option value="all">{m.allSources}</option>
                  {Object.entries(m.usageSources).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <DayUsage
                value={usageDay}
                metric={preferences.usageMetric}
                failed={usageError}
                loading={usageLoading}
                partial={usageTruncated}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{m.usageScope}</p>
              {usageTruncated && <p className="mt-2 text-xs text-warning">{m.usageSummaryPartial}</p>}
              <Button className="mt-3" variant="outline" size="sm" onClick={onUsageDetails}>
                {m.usageDetails}
              </Button>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
