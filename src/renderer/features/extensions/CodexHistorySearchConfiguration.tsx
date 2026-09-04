import { useMemo, useState, type ReactNode } from 'react';
import {
  ArchiveIcon,
  ExternalLinkIcon,
  FolderIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  UserIcon,
} from 'lucide-react';
import type { CodexHistoryIndexState, CodexHistorySearchResult, ExtensionDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { CodexHistoryAutoPager } from '@/renderer/features/extensions/CodexHistoryAutoPager';
import { CodexHistoryNavigation } from '@/renderer/features/extensions/CodexHistoryNavigation';
import { CodexHistorySearchFilters } from '@/renderer/features/extensions/CodexHistorySearchFilters';
import { CodexHistoryThreadDetail } from '@/renderer/features/extensions/CodexHistoryThreadDetail';
import { useCodexHistorySearch } from '@/renderer/features/extensions/useCodexHistorySearch';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  standalone?: boolean;
  workspaceNavigation?: ReactNode;
  notify(message: string): void;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const index = normalizedQuery ? text.toLocaleLowerCase().indexOf(normalizedQuery) : -1;
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-warning-surface px-0.5 text-foreground">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

function HistoryIndexNotice({ error, index }: { error: string | null; index: CodexHistoryIndexState }) {
  if (error) {
    return (
      <div role="alert" className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }
  if (!index.message || index.status === 'INDEXING') return null;
  return (
    <div role="status" className="shrink-0 border-b bg-warning-surface/40 px-4 py-2 text-xs text-warning">
      {index.message}
    </div>
  );
}

function ResultIcon({ role }: Pick<CodexHistorySearchResult, 'role'>) {
  if (role === 'ASSISTANT') return <MessageSquareTextIcon className="size-3.5" />;
  if (role === 'THREAD') return <SearchIcon className="size-3.5" />;
  return <UserIcon className="size-3.5" />;
}

function repeatsTitle(item: CodexHistorySearchResult) {
  const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return normalized(item.snippet) === normalized(item.title);
}

export function CodexHistorySearchConfiguration({
  active,
  extension,
  standalone = false,
  workspaceNavigation = null,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexHistorySearch;
  const authorized =
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted);
  const state = useCodexHistorySearch({ active, authorized, notify });
  const snapshot = state.snapshot;
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const selectedItem = useMemo(
    () => snapshot?.items.find((item) => item.threadId === selectedThreadId) ?? snapshot?.items[0] ?? null,
    [selectedThreadId, snapshot?.items],
  );

  return (
    <section
      data-codex-history-search-configuration
      className={cn('overflow-hidden bg-background', standalone ? 'flex size-full min-h-0' : 'rounded-lg border')}
    >
      {standalone && (
        <CodexHistoryNavigation
          state={state}
          workspaceNavigation={workspaceNavigation}
          selectedThreadId={selectedThreadId}
          onSelectThread={setSelectedThreadId}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="sr-only">{l.title}</h2>
        {authorized && <CodexHistorySearchFilters authorized={authorized} state={state} />}

        {state.index.status === 'INDEXING' && (
          <div className="shrink-0 border-b px-4 py-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              <span>{l.indexing(state.index.progress)}</span>
              <div className="h-1 min-w-20 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full bg-primary" style={{ width: `${state.index.progress}%` }} />
              </div>
            </div>
          </div>
        )}

        <HistoryIndexNotice error={state.error ?? state.filtersError} index={state.index} />

        {!authorized || state.index.status === 'UNAVAILABLE' ? (
          <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">{l.unavailable}</div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-[1.45] flex-col">
              <header className="flex min-h-11 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
                <span>{snapshot?.truncated ? `${l.matches(snapshot.total)}+` : l.matches(snapshot?.total ?? 0)}</span>
                <span className="hidden sm:inline">
                  {l.indexed(state.index.indexedThreads, state.index.indexedMessages)}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={l.actions.refresh}
                    title={l.actions.refresh}
                    disabled={state.refreshing}
                    onClick={() => void state.refresh(false)}
                  >
                    {state.refreshing ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={l.actions.rebuild}
                    title={l.actions.rebuild}
                    disabled={state.refreshing}
                    onClick={() => void state.refresh(true)}
                  >
                    <RotateCcwIcon className="size-4" />
                  </Button>
                </div>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {snapshot?.items.length ? (
                  <div className="divide-y">
                    {snapshot.items.map((item) => {
                      const selected = item.threadId === selectedItem?.threadId;
                      return (
                        <article
                          key={item.threadId}
                          data-current={selected || undefined}
                          className="group flex data-[current]:bg-selected/70 hover:bg-hover"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            onClick={() => setSelectedThreadId(item.threadId)}
                            onDoubleClick={() => void state.openThread(item.threadId)}
                          >
                            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
                              <ResultIcon role={item.role} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium">
                                  <HighlightedText text={item.title} query={state.draftQuery} />
                                </span>
                                {item.archived && <ArchiveIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                                {item.source === 'SUBAGENT' && <Badge variant="outline">{l.subagent}</Badge>}
                                {item.matchCount > 1 && (
                                  <Badge variant="secondary">{l.matchOccurrences(item.matchCount)}</Badge>
                                )}
                              </span>
                              {item.snippet && !repeatsTitle(item) && (
                                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                                  <HighlightedText text={item.snippet} query={state.draftQuery} />
                                </span>
                              )}
                              <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                                {(item.projectName || item.workspace) && (
                                  <span className="inline-flex min-w-0 items-center gap-1">
                                    <FolderIcon className="size-3 shrink-0" />
                                    <span className="max-w-52 truncate">{item.projectName || item.workspace}</span>
                                  </span>
                                )}
                                {item.sectionName && <span>{item.sectionName}</span>}
                                {item.branch && (
                                  <span className="inline-flex items-center gap-1">
                                    <GitBranchIcon className="size-3" />
                                    {item.branch}
                                  </span>
                                )}
                                <span>
                                  {new Intl.DateTimeFormat(locale, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  }).format(new Date(item.updatedAt))}
                                </span>
                              </span>
                            </span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="mr-2 mt-2 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={l.preview.open}
                            title={l.preview.open}
                            onClick={() => void state.openThread(item.threadId)}
                          >
                            <ExternalLinkIcon className="size-4" />
                          </Button>
                        </article>
                      );
                    })}
                    <CodexHistoryAutoPager
                      error={state.error}
                      hasMore={state.hasMore}
                      loading={state.loadingMore}
                      onLoadMore={() => void state.loadMore()}
                    />
                  </div>
                ) : state.loading || state.index.status === 'INDEXING' ? (
                  <div className="grid min-h-40 place-items-center">
                    <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">{l.empty}</div>
                )}
              </div>
            </main>
            <CodexHistoryThreadDetail
              item={selectedItem}
              locale={locale}
              onOpen={(threadId) => void state.openThread(threadId)}
            />
          </div>
        )}
      </div>
    </section>
  );
}
