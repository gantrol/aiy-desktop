import { useEffect, useMemo, useState } from 'react';
import type { ArticleDto, BootstrapDto, ExtensionDto } from '@/shared/contracts';
import type { WorkCommand } from '@/shared/contracts/work-tracking';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useWorkTracking } from '@/renderer/features/work-tracking/useWorkTracking';
import { WorkTrackingToolbar, type WorkFilters } from '@/renderer/features/work-tracking/WorkTrackingToolbar';
import { workTrackingView } from '@/renderer/features/work-tracking/workTrackingView';
import { WorkTrackingEditors, type WorkEditor } from '@/renderer/features/work-tracking/WorkTrackingEditors';
import { WorkItemsTable, WorkTasksTable } from '@/renderer/features/work-tracking/WorkTables';
import { WorkTaskDetails } from '@/renderer/features/work-tracking/WorkDetails';
import { WorkAlbumTable } from '@/renderer/features/work-tracking/WorkAlbumTable';
import { WorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';
import { WorkItemPane } from '@/renderer/features/work-tracking/WorkItemPane';
import { useWorkHandoff } from '@/renderer/features/work-tracking/useWorkHandoff';
import { WorkExecutionsTable } from '@/renderer/features/work-tracking/WorkExecutions';

function isAvailable(active: boolean, extension: ExtensionDto) {
  return (
    active &&
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted)
  );
}

export function WorkTrackingScreen({
  active,
  data,
  extension,
  notify,
  albumId,
  onArticleSaved,
}: {
  active: boolean;
  data: BootstrapDto;
  extension: ExtensionDto;
  notify(message: string): void;
  albumId?: string;
  onArticleSaved(article: ArticleDto): void;
}) {
  const l = useI18n().messages.workTracking;
  const available = isAvailable(active, extension);
  const { snapshot, busy, error, refresh, mutate } = useWorkTracking(data.spaceId, available);
  const [filters, setFilters] = useState<WorkFilters>({
    tab: 'items',
    search: '',
    kind: 'ALL',
    status: 'ALL',
    showStopped: false,
  });
  const { tab } = filters;
  const changeFilters = (next: Partial<WorkFilters>) => {
    setFilters((old) => ({ ...old, ...next }));
    setPage(0);
  };
  const [page, setPage] = useState(0);
  const [itemId, setItemId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [editor, setEditor] = useState<WorkEditor | null>(null);
  const { copying, copy } = useWorkHandoff(data.spaceId, available, notify);
  useEffect(() => {
    if (!available) setEditor(null);
  }, [available]);
  const { sources, titles, articleRevisions, items, tasks, taskItems, executions } = useMemo(
    () => workTrackingView(data, snapshot, filters, l.noSource, albumId, l.untitled),
    [data, snapshot, filters, l.noSource, albumId, l.untitled],
  );
  const albumTable = tab === 'items' && Boolean(albumId);
  const counts: Record<string, number> = { items: items.length, tasks: tasks.length, executions: executions.length };
  const emptyLabels: Record<string, string> = { items: l.empty, tasks: l.emptyTasks, executions: l.emptyAttempts };
  const entryCount = counts[tab] ?? 0;
  const total = Math.max(1, Math.ceil(entryCount / 40));
  const currentPage = Math.min(page, total - 1);
  const item = snapshot?.items.find((entry) => entry.id === itemId);
  const task = snapshot?.tasks.find((entry) => entry.id === taskId);
  const selectedArticleId = item?.articleId ?? sourceId;
  const details: Record<string, unknown> = { items: selectedArticleId, tasks: task };
  const hasDetails = Boolean(details[tab]);
  const openTask = (id: string) => {
    setTaskId(id);
    changeFilters({ tab: 'tasks' });
  };
  const openItem = (id: string) => {
    setItemId(id);
    setSourceId(null);
    changeFilters({ tab: 'items' });
  };
  const save = async (command: WorkCommand) => {
    if (editor && (await mutate(command, editor.revision))) setEditor(null);
  };
  if (!available)
    return (
      <div role="status" className="text-sm text-muted-foreground">
        {l.errors.disabled}
      </div>
    );
  const editorProps = {
    busy,
    error: error ? l.errors[error] : undefined,
    onClose: () => setEditor(null),
    onSave: (command: WorkCommand) => void save(command),
  };
  return (
    <div className="@container/extension-detail grid min-w-0 gap-4">
      <WorkTrackingToolbar
        articles={data.articles}
        value={filters}
        onChange={changeFilters}
        busy={busy}
        ready={Boolean(snapshot)}
        canTrack={!albumId}
        onRefresh={() => void refresh()}
        onCreate={() => {
          if (snapshot) setEditor({ kind: tab === 'items' ? 'track' : 'task', revision: snapshot.revision });
        }}
      />
      {error && !editor && (
        <div role="alert" className="text-sm text-destructive">
          {l.errors[error]}
        </div>
      )}
      {!snapshot ? (
        <div role="status">{busy ? l.loading : l.empty}</div>
      ) : (
        <WorkTableEditing
          key={data.spaceId}
          data={data}
          snapshot={snapshot}
          busy={busy}
          error={error ? l.errors[error] : undefined}
          mutate={mutate}
          onArticleSaved={onArticleSaved}
        >
          <div
            className={cn('grid min-w-0 gap-5', hasDetails && '@6xl/extension-detail:grid-cols-[minmax(0,1fr)_20rem]')}
          >
            <div className="min-w-0">
              {albumTable ? (
                <WorkAlbumTable
                  key={JSON.stringify(filters)}
                  data={data}
                  albumId={albumId!}
                  snapshot={snapshot}
                  filters={filters}
                  busy={busy}
                  error={error ? l.errors[error] : undefined}
                  onMutate={mutate}
                  onSelect={(id, articleId) => {
                    setItemId(id);
                    setSourceId(articleId);
                  }}
                />
              ) : tab === 'items' ? (
                <WorkItemsTable
                  items={items.slice(currentPage * 40, (currentPage + 1) * 40)}
                  titles={titles}
                  selectedId={itemId}
                  onSelect={openItem}
                />
              ) : tab === 'executions' ? (
                <WorkExecutionsTable
                  executions={executions.slice(currentPage * 40, (currentPage + 1) * 40)}
                  titles={titles}
                  onItem={openItem}
                />
              ) : (
                <WorkTasksTable
                  tasks={tasks.slice(currentPage * 40, (currentPage + 1) * 40)}
                  attempts={snapshot.attempts}
                  selectedId={taskId}
                  onSelect={setTaskId}
                />
              )}
              {!albumTable && !entryCount && (
                <div role="status" className="py-8 text-center text-sm text-muted-foreground">
                  {emptyLabels[tab]}
                </div>
              )}
              {!albumTable && total > 1 && (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button variant="ghost" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
                    {l.previous}
                  </Button>
                  <span className="text-xs">
                    {currentPage + 1} / {total}
                  </span>
                  <Button variant="ghost" disabled={currentPage + 1 >= total} onClick={() => setPage(currentPage + 1)}>
                    {l.next}
                  </Button>
                </div>
              )}
            </div>
            <div
              className={cn(
                'min-w-0 border-t border-border pt-4 @6xl/extension-detail:border-t-0 @6xl/extension-detail:border-l @6xl/extension-detail:pt-0 @6xl/extension-detail:pl-5',
                !hasDetails && 'hidden',
              )}
            >
              {tab === 'items' && selectedArticleId && (
                <WorkItemPane
                  item={item}
                  articleId={selectedArticleId}
                  onEdit={() => {
                    if (item) setEditor({ kind: 'item', item, revision: snapshot.revision });
                  }}
                  onDelegate={() => {
                    if (item) setEditor({ kind: 'task', itemId: item.id, revision: snapshot.revision });
                  }}
                  onTask={openTask}
                  onClose={() => {
                    setItemId(null);
                    setSourceId(null);
                  }}
                  notify={notify}
                />
              )}
              {tab === 'tasks' && task && (
                <WorkTaskDetails
                  task={task}
                  snapshot={snapshot}
                  articleRevisions={articleRevisions}
                  busy={busy || copying}
                  onCopy={() => void copy(task.id)}
                  onAssign={() => setEditor({ kind: 'assign', task, revision: snapshot.revision })}
                  onRecord={(attempt) => setEditor({ kind: 'attempt', task, attempt, revision: snapshot.revision })}
                  onItem={openItem}
                />
              )}
            </div>
          </div>
          <WorkTrackingEditors
            {...editorProps}
            editor={editor}
            snapshot={snapshot}
            titles={titles}
            sources={sources}
            taskItems={taskItems}
          />
        </WorkTableEditing>
      )}
    </div>
  );
}
