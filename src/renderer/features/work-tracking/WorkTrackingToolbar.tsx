import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { WorkSelect } from '@/renderer/features/work-tracking/WorkFields';
import { useI18n } from '@/renderer/i18n/useI18n';
import { workItemKinds, workItemStates } from '@/shared/contracts/work-tracking';
import type { ArticleListItem } from '@/shared/contracts';
import { ContentAuthorFilter } from '@/renderer/features/me/ContentAuthorFilter';

export interface WorkFilters {
  tab: string;
  search: string;
  kind: 'ALL' | 'UNTRACKED' | (typeof workItemKinds)[number];
  status: 'ALL' | (typeof workItemStates)[number];
  showStopped: boolean;
  author?: string;
}
export function WorkTrackingToolbar({
  value,
  onChange,
  busy,
  ready,
  onRefresh,
  onCreate,
  canTrack = true,
  articles = [],
}: {
  value: WorkFilters;
  onChange(value: Partial<WorkFilters>): void;
  busy: boolean;
  ready: boolean;
  onRefresh(): void;
  onCreate(): void;
  canTrack?: boolean;
  articles?: ArticleListItem[];
}) {
  const l = useI18n().messages.workTracking;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={value.tab} onValueChange={(tab) => onChange({ tab })}>
          <TabsList>
            <TabsTrigger value="items">{l.items}</TabsTrigger>
            <TabsTrigger value="tasks">{l.tasks}</TabsTrigger>
            <TabsTrigger value="executions">{l.externalExecutions}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={onRefresh}>
            {l.refresh}
          </Button>
          {value.tab !== 'executions' && (canTrack || value.tab !== 'items') && (
            <Button disabled={busy || !ready} onClick={onCreate}>
              {value.tab === 'items' ? l.track : l.createTask}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-40 flex-1"
          aria-label={l.search}
          placeholder={l.search}
          value={value.search}
          onChange={(event) => onChange({ search: event.target.value })}
        />
        {value.tab === 'items' && (
          <>
            <div>
              <WorkSelect
                label={l.kind}
                value={value.kind}
                values={['ALL', ...(!canTrack ? ['UNTRACKED' as const] : []), ...workItemKinds]}
                labels={{ ALL: `${l.kind}: ${l.all}`, UNTRACKED: l.untracked, ...l.kinds }}
                onChange={(kind) => onChange({ kind })}
              />
            </div>
            <div>
              <WorkSelect
                label={l.state}
                value={value.status}
                values={['ALL', ...workItemStates]}
                labels={{ ALL: `${l.state}: ${l.all}`, ...l.states }}
                onChange={(status) => onChange({ status })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.showStopped}
                onCheckedChange={(checked) => onChange({ showStopped: checked === true })}
              />
              {l.showStopped}
            </label>
            <ContentAuthorFilter articles={articles} value={value.author} onChange={(author) => onChange({ author })} />
          </>
        )}
      </div>
    </>
  );
}
