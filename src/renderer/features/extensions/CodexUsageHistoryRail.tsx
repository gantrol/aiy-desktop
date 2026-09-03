import { ActivityIcon, HistoryIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CodexUsageHistoryItem, CodexUsageTask } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { formatCodexUsageDateRange } from '@/renderer/features/extensions/CodexUsageDateRangePicker';
import type { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

type UsageLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator'];

interface Props {
  history: readonly CodexUsageHistoryItem[];
  locale: 'en' | 'zh';
  labels: UsageLabels;
  selectedId: string | null;
  task: CodexUsageTask | null;
  workspaceNavigation?: ReactNode;
  onSelect(investigationId: string): void;
}

function rangeLabel(
  item: Pick<CodexUsageHistoryItem, 'range' | 'dateRange'>,
  labels: UsageLabels,
  locale: 'en' | 'zh',
) {
  return item.range === 'CUSTOM' && item.dateRange
    ? formatCodexUsageDateRange(item.dateRange, locale)
    : labels.ranges[item.range];
}

function taskTone(task: CodexUsageTask) {
  if (task.status === 'RUNNING') return 'bg-info';
  if (task.status === 'FAILED') return 'bg-destructive';
  return 'bg-warning';
}

function CurrentTask({ task, labels, locale }: { task: CodexUsageTask; labels: UsageLabels; locale: 'en' | 'zh' }) {
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return null;
  const status = labels.reportRail.taskStatuses[task.status];
  return (
    <div className="grid gap-1 border-b px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span aria-hidden className={cn('size-1.5 rounded-full', taskTone(task))} />
        <span>{status}</span>
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {rangeLabel(task, labels, locale)}
        {task.status === 'RUNNING' ? ` · ${labels.phases[task.progress.phase]}` : ''}
      </div>
    </div>
  );
}

export function CodexUsageHistoryRail({
  history,
  locale,
  labels,
  selectedId,
  task,
  workspaceNavigation,
  onSelect,
}: Props) {
  const numberLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  const date = new Intl.DateTimeFormat(numberLocale, { dateStyle: 'medium', timeStyle: 'short' });
  const tokens = new Intl.NumberFormat(numberLocale, { notation: 'compact', maximumFractionDigits: 1 });
  return (
    <aside
      className="hidden h-full w-60 shrink-0 flex-col border-r bg-surface-sunken/20 md:flex"
      aria-label={labels.history}
    >
      {workspaceNavigation && <div className="border-b p-2">{workspaceNavigation}</div>}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <HistoryIcon className="size-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold">{labels.history}</h3>
        <Badge variant="secondary" className="ml-auto tabular-nums">
          {history.length}
        </Badge>
      </header>
      {task && <CurrentTask task={task} labels={labels} locale={locale} />}
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-0.5 p-2">
          {history.map((item) => {
            const selected = item.investigationId === selectedId;
            return (
              <Button
                key={item.investigationId}
                type="button"
                variant="ghost"
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'h-auto w-full min-w-0 justify-start rounded-md px-2.5 py-2 text-left font-normal',
                  selected && 'bg-selected text-selected-foreground hover:bg-selected active:bg-selected',
                )}
                onClick={() => onSelect(item.investigationId)}
              >
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <ActivityIcon className="size-3.5 shrink-0" />
                    <span className="truncate text-xs font-medium">{rangeLabel(item, labels, locale)}</span>
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {item.sessionCount} {labels.metrics.sessions} · {tokens.format(item.totalTokens)}{' '}
                    {labels.chart.total}
                  </span>
                  <span className="truncate text-[10px] tabular-nums text-muted-foreground">
                    {date.format(new Date(item.generatedAt))}
                  </span>
                </span>
              </Button>
            );
          })}
          {!history.length && (
            <div className="grid min-h-24 place-items-center px-3 text-center text-xs text-muted-foreground">
              {labels.reportRail.empty}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
