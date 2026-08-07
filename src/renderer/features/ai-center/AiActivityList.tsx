import { useEffect, useState } from 'react';
import { FlaskConicalIcon, ImagePlusIcon, LightbulbIcon, ListChecksIcon, PaintbrushIcon } from 'lucide-react';
import type { ImageGenerationRouteDto, Locale } from '@/shared/contracts';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  activityDuration,
  activityMatchesFilters,
  activityStatusFilter,
  type AiActivityCategoryFilter,
  type AiActivityRecord,
  type AiActivityStatusFilter,
} from '@/renderer/features/ai-center/activityProjection';
import { AiActivityStatusTag } from '@/renderer/features/ai-center/AiActivityStatusTag';

interface Props {
  active: boolean;
  records: AiActivityRecord[];
  categoryFilter: AiActivityCategoryFilter;
  statusFilter: AiActivityStatusFilter;
  selectedId: string | null;
  currentDraftId: string | null;
  locale: Locale;
  routes: ImageGenerationRouteDto[];
  onCategoryFilterChange(filter: AiActivityCategoryFilter): void;
  onStatusFilterChange(filter: AiActivityStatusFilter): void;
  onSelect(recordId: string): void;
}

interface DurationFormatters {
  seconds(value: number): string;
  minutesSeconds(minutes: number, seconds: number): string;
  hoursMinutes(hours: number, minutes: number): string;
}

function formatDuration(milliseconds: number, formatters: DurationFormatters) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return formatters.hoursMinutes(hours, minutes);
  if (minutes > 0) return formatters.minutesSeconds(minutes, seconds);
  return formatters.seconds(seconds);
}

function kindIcon(record: AiActivityRecord) {
  if (record.kind === 'ASSISTANT') {
    return record.run.mode === 'directions' ? (
      <LightbulbIcon className="size-4" />
    ) : (
      <ListChecksIcon className="size-4" />
    );
  }
  if (record.kind === 'EXPERIMENT') return <FlaskConicalIcon className="size-4" />;
  return record.operation === 'EDIT' ? <PaintbrushIcon className="size-4" /> : <ImagePlusIcon className="size-4" />;
}

function sourceName(
  record: AiActivityRecord,
  locale: Locale,
  currentDraftId: string | null,
  draft: string,
  unknown: string,
) {
  if (record.sourceSeries) return record.sourceSeries.title;
  if (record.kind !== 'GENERATION') {
    const scope = record.kind === 'ASSISTANT' ? record.run.scope : record.batch.scope;
    if (scope.kind === 'DRAFT' && scope.id === currentDraftId) return draft;
  }
  return unknown;
}

export function AiActivityList({
  active,
  records,
  categoryFilter,
  statusFilter,
  selectedId,
  currentDraftId,
  locale,
  routes,
  onCategoryFilterChange,
  onStatusFilterChange,
  onSelect,
}: Props) {
  const l = useI18n().messages.aiCenter;
  const filtered = records.filter((record) => activityMatchesFilters(record, categoryFilter, statusFilter));
  const hasRunning = active && filtered.some((record) => activityStatusFilter(record) === 'RUNNING');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunning) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  const modelByKey = new Map(routes.map((model) => [model.key, model]));
  const dateFormatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const categories: Array<{ id: AiActivityCategoryFilter; label: string }> = [
    { id: 'ALL', label: l.filters.all },
    { id: 'IMAGE', label: l.filters.image },
    { id: 'TEXT', label: l.filters.text },
    { id: 'GENERATE', label: l.kinds.generate },
    { id: 'EDIT', label: l.kinds.edit },
    { id: 'EXPERIMENT', label: l.kinds.experiment },
    { id: 'DIRECTIONS', label: l.kinds.directions },
    { id: 'OPTIMIZE', label: l.kinds.optimize },
  ];
  const statuses: Array<{ id: AiActivityStatusFilter; label: string }> = [
    { id: 'ALL', label: l.filters.all },
    { id: 'ATTENTION', label: l.filters.attention },
    { id: 'RUNNING', label: l.filters.running },
    { id: 'COMPLETED', label: l.filters.completed },
    { id: 'EXPIRED', label: l.filters.expired },
  ];
  const durations = filtered.map((record) => activityDuration(record, now)).filter((value) => value !== null);
  const completedDurations = durations.filter((duration) => !duration.running);
  const averageDuration =
    completedDurations.length > 0
      ? completedDurations.reduce((sum, duration) => sum + duration.milliseconds, 0) / completedDurations.length
      : null;
  const runningCount = filtered.filter((record) => activityStatusFilter(record) === 'RUNNING').length;

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r bg-background" aria-label={l.tabs.activity}>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-b bg-surface px-4 py-3">
        <div className="grid min-w-0 gap-1 text-2xs text-muted-foreground">
          <span>{l.filters.type}</span>
          <Select
            value={categoryFilter}
            onValueChange={(value) => onCategoryFilterChange(value as AiActivityCategoryFilter)}
          >
            <SelectTrigger aria-label={l.filters.type} className="h-8 bg-surface text-xs text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1 text-2xs text-muted-foreground">
          <span>{l.filters.status}</span>
          <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as AiActivityStatusFilter)}>
            <SelectTrigger aria-label={l.filters.status} className="h-8 bg-surface text-xs text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface px-4 py-2 text-2xs text-muted-foreground">
        <span>{l.stats.recordCount(filtered.length)}</span>
        {averageDuration !== null && (
          <span>
            {l.stats.averageDuration} {formatDuration(averageDuration, l.stats)}
          </span>
        )}
        {runningCount > 0 && (
          <span>
            {l.stats.running} {runningCount}
          </span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {filtered.map((record) => {
            const duration = activityDuration(record, now);
            const source = sourceName(record, locale, currentDraftId, l.source.draft, l.source.unknown);
            const kind =
              record.kind === 'ASSISTANT'
                ? record.run.mode === 'directions'
                  ? l.kinds.directions
                  : l.kinds.optimize
                : record.kind === 'EXPERIMENT'
                  ? l.kinds.experiment
                  : record.operation === 'EDIT'
                    ? l.kinds.edit
                    : l.kinds.generate;
            const title =
              record.kind === 'ASSISTANT' && record.occurrenceCount > 1
                ? `${kind} · ${l.occurrence(record.ordinal)}`
                : `${kind} · ${source}`;
            const secondary =
              record.kind === 'GENERATION'
                ? `${l.version(record.version.versionNo)} · ${modelByKey.get(record.run.modelKey)?.name ?? record.run.modelKey}`
                : record.kind === 'EXPERIMENT'
                  ? `${record.batch.slots.length} ${l.fields.directions} · ${record.batch.completedCount}/${record.batch.totalCount}`
                  : source;
            return (
              <button
                key={record.id}
                type="button"
                data-ai-activity-id={record.id}
                aria-current={record.id === selectedId ? 'true' : undefined}
                className={cn(
                  'grid w-full grid-cols-[34px_minmax(0,1fr)_auto] gap-3 border-l-2 border-l-transparent px-3 py-3 text-left outline-none transition-colors duration-fast hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  record.id === selectedId && 'border-l-selected-foreground bg-selected',
                )}
                onClick={() => onSelect(record.id)}
              >
                <span className="grid size-[34px] place-items-center rounded-md bg-surface-sunken text-foreground-secondary">
                  {kindIcon(record)}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-medium">{title}</strong>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
                  <span className="mt-1 flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
                    <time dateTime={record.createdAt}>{dateFormatter.format(new Date(record.createdAt))}</time>
                    {duration && (
                      <>
                        <span>·</span>
                        <span>
                          {duration.running ? l.stats.elapsed : l.stats.duration}{' '}
                          {formatDuration(duration.milliseconds, l.stats)}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <AiActivityStatusTag record={record} />
              </button>
            );
          })}
        </div>
        {filtered.length === 0 && <div className="px-6 py-12 text-center text-sm text-muted-foreground">{l.empty}</div>}
      </ScrollArea>
    </aside>
  );
}
