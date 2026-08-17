import { useEffect, useMemo, useState } from 'react';
import { Clock3Icon, ListTreeIcon } from 'lucide-react';
import type { BootstrapDto, ImageGenerationRouteDto, Locale } from '@/shared/contracts';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AiActivityOutline } from '@/renderer/features/ai-center/AiActivityOutline';
import { AiActivityRow, formatAiActivityDuration } from '@/renderer/features/ai-center/AiActivityRow';
import {
  activityDuration,
  activityMatchesFilters,
  activityStatusFilter,
  type AiActivityCategoryFilter,
  type AiActivityRecord,
  type AiActivityStatusFilter,
} from '@/renderer/features/ai-center/activityProjection';
import { projectAiActivityOutcomeOutline } from '@/renderer/features/ai-center/outcomeOutlineProjection';

export type AiActivityViewMode = 'OUTLINE' | 'TIMELINE';

interface Props {
  active: boolean;
  records: AiActivityRecord[];
  categoryFilter: AiActivityCategoryFilter;
  statusFilter: AiActivityStatusFilter;
  viewMode: AiActivityViewMode;
  selectedId: string | null;
  currentDraftId: string | null;
  locale: Locale;
  routes: ImageGenerationRouteDto[];
  outlineContext: Pick<BootstrapDto, 'creationDraft' | 'creations'>;
  onCategoryFilterChange(filter: AiActivityCategoryFilter): void;
  onStatusFilterChange(filter: AiActivityStatusFilter): void;
  onViewModeChange(mode: AiActivityViewMode): void;
  onSelect(recordId: string): void;
}

export function AiActivityList({
  active,
  records,
  categoryFilter,
  statusFilter,
  viewMode,
  selectedId,
  currentDraftId,
  locale,
  routes,
  outlineContext,
  onCategoryFilterChange,
  onStatusFilterChange,
  onViewModeChange,
  onSelect,
}: Props) {
  const l = useI18n().messages.aiCenter;
  const modelNameByKey = useMemo(() => new Map(routes.map((model) => [model.key, model.name])), [routes]);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );
  const filtered = useMemo(
    () => records.filter((record) => activityMatchesFilters(record, categoryFilter, statusFilter)),
    [categoryFilter, records, statusFilter],
  );
  const hasRunning = active && filtered.some((record) => activityStatusFilter(record) === 'RUNNING');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunning) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  const categories: Array<{ id: AiActivityCategoryFilter; label: string }> = [
    { id: 'ALL', label: l.filters.all },
    { id: 'IMAGE', label: l.filters.image },
    { id: 'TEXT', label: l.filters.text },
    { id: 'DOCUMENT', label: l.filters.document },
    { id: 'GENERATE', label: l.kinds.generate },
    { id: 'EDIT', label: l.kinds.edit },
    { id: 'EXPERIMENT', label: l.kinds.experiment },
    { id: 'DIRECTIONS', label: l.kinds.directions },
    { id: 'OPTIMIZE', label: l.kinds.optimize },
    { id: 'VIDEO_ARTICLE', label: l.kinds.videoArticle },
    { id: 'TRANSCRIBE', label: l.kinds.transcribe },
    { id: 'TRANSLATE', label: l.kinds.translate },
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
  const outlineGroups = useMemo(
    () => (viewMode === 'OUTLINE' ? projectAiActivityOutcomeOutline(filtered, outlineContext, records) : []),
    [filtered, outlineContext, records, viewMode],
  );

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r bg-background" aria-label={l.tabs.activity}>
      <div className="shrink-0 border-b bg-surface px-4 py-2.5">
        <Segmented
          type="single"
          value={viewMode}
          aria-label={l.views.label}
          className="grid w-full grid-cols-2"
          onValueChange={(value) => {
            if (value) onViewModeChange(value as AiActivityViewMode);
          }}
        >
          <SegmentedItem value="OUTLINE" className="gap-1.5 px-2">
            <ListTreeIcon className="size-3.5" />
            {l.views.outline}
          </SegmentedItem>
          <SegmentedItem value="TIMELINE" className="gap-1.5 px-2">
            <Clock3Icon className="size-3.5" />
            {l.views.timeline}
          </SegmentedItem>
        </Segmented>
      </div>
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
        {viewMode === 'OUTLINE' && <span>{l.outline.outcomeCount(outlineGroups.length)}</span>}
        {averageDuration !== null && (
          <span>
            {l.stats.averageDuration} {formatAiActivityDuration(averageDuration, l.stats)}
          </span>
        )}
        {runningCount > 0 && (
          <span>
            {l.stats.running} {runningCount}
          </span>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">{l.empty}</div>
      ) : viewMode === 'OUTLINE' ? (
        <AiActivityOutline
          groups={outlineGroups}
          selectedId={selectedId}
          currentDraftId={currentDraftId}
          modelNameByKey={modelNameByKey}
          dateFormatter={dateFormatter}
          now={now}
          onSelect={onSelect}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="divide-y">
            {filtered.map((record) => (
              <AiActivityRow
                key={record.id}
                record={record}
                selected={record.id === selectedId}
                currentDraftId={currentDraftId}
                modelNameByKey={modelNameByKey}
                dateFormatter={dateFormatter}
                now={now}
                onSelect={onSelect}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
