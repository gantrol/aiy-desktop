import {
  ArchiveIcon,
  BotIcon,
  ExternalLinkIcon,
  FolderIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  UserIcon,
} from 'lucide-react';
import type { CodexHistoryIndexState, ExtensionDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { CodexHistoryAutoPager } from '@/renderer/features/extensions/CodexHistoryAutoPager';
import { CodexHistorySearchFilters } from '@/renderer/features/extensions/CodexHistorySearchFilters';
import { useCodexHistorySearch } from '@/renderer/features/extensions/useCodexHistorySearch';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  standalone?: boolean;
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

export function CodexHistorySearchConfiguration({ active, extension, standalone = false, notify }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexHistorySearch;
  const authorized =
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted);
  const state = useCodexHistorySearch({ active, authorized, notify });
  const snapshot = state.snapshot;
  const Heading = standalone ? 'h2' : 'h3';

  return (
    <section
      data-codex-history-search-configuration
      className={cn(
        'overflow-hidden bg-background',
        standalone ? 'flex size-full min-h-0 flex-col' : 'rounded-lg border',
      )}
    >
      <header className={cn('flex items-center gap-2 border-b', standalone ? 'min-h-14 px-5 py-2' : 'px-4 py-3')}>
        <SearchIcon className="size-4" />
        <Heading className={cn('font-semibold', standalone ? 'text-base' : 'text-sm')}>{l.title}</Heading>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={l.actions.refresh}
            title={l.actions.refresh}
            disabled={!authorized || state.refreshing}
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
            disabled={!authorized || state.refreshing}
            onClick={() => void state.refresh(true)}
          >
            <RotateCcwIcon className="size-4" />
          </Button>
        </div>
      </header>

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

      <div className={cn('min-h-0 p-4', standalone && 'flex-1 overflow-y-auto')}>
        {!authorized || state.index.status === 'UNAVAILABLE' ? (
          <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">{l.unavailable}</div>
        ) : snapshot?.items.length ? (
          <div className="overflow-hidden rounded-md border">
            <div className="flex items-center justify-between border-b bg-surface-sunken/40 px-3 py-2 text-xs text-muted-foreground">
              <span>{snapshot.truncated ? `${l.matches(snapshot.total)}+` : l.matches(snapshot.total)}</span>
              <span>{l.indexed(state.index.indexedThreads, state.index.indexedMessages)}</span>
            </div>
            <div className="divide-y">
              {snapshot.items.map((item) => (
                <button
                  key={item.threadId}
                  type="button"
                  className="group flex w-full items-start gap-3 px-3 py-3 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => void state.openThread(item.threadId)}
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
                    {item.role === 'ASSISTANT' ? (
                      <BotIcon className="size-3.5" />
                    ) : item.role === 'THREAD' ? (
                      <SearchIcon className="size-3.5" />
                    ) : (
                      <UserIcon className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        <HighlightedText text={item.title} query={state.draftQuery} />
                      </span>
                      {item.archived && <ArchiveIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                      {item.source === 'SUBAGENT' && <Badge variant="outline">{l.subagent}</Badge>}
                      {item.matchCount > 1 && <Badge variant="secondary">{l.matchOccurrences(item.matchCount)}</Badge>}
                    </span>
                    {item.snippet && (
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
                      {item.projectName && item.workspace && (
                        <span className="max-w-64 truncate" title={item.workspace}>
                          {item.workspace}
                        </span>
                      )}
                      {item.branch && (
                        <span className="inline-flex items-center gap-1">
                          <GitBranchIcon className="size-3" />
                          {item.branch}
                        </span>
                      )}
                      <span>
                        {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                          new Date(item.updatedAt),
                        )}
                      </span>
                    </span>
                  </span>
                  <ExternalLinkIcon className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                </button>
              ))}
            </div>
            <CodexHistoryAutoPager
              error={state.error}
              hasMore={state.hasMore}
              loading={state.loadingMore}
              onLoadMore={() => void state.loadMore()}
            />
          </div>
        ) : state.loading || state.index.status === 'INDEXING' ? (
          <div className="grid min-h-32 place-items-center">
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">{l.empty}</div>
        )}
      </div>
    </section>
  );
}
