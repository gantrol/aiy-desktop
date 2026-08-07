import { ArchiveIcon, FilePenLineIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { TermListItem } from '@/shared/contracts';
import { primaryTermClassification } from '@/shared/term-localization';
import type { DictionaryMessages } from '@/renderer/i18n/catalog';
import { cn } from '@/renderer/lib/utils';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { StatusDot } from '@/renderer/components/ui/status-dot';

interface Props {
  copy: DictionaryMessages;
  terms: TermListItem[];
  total: number;
  initialLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadError: string;
  selectedId: string;
  onSelect(termId: string): void;
  onShowMedia(termId: string): void;
  onDelete(term: TermListItem): void;
  onRestore(term: TermListItem): void;
  onLoadMore(): void;
}

function TermListSkeleton() {
  return (
    <div className="space-y-2 px-2 pt-1" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex min-h-[74px] gap-3 rounded-xl border border-border/50 bg-background/55 p-3">
          {index < 3 && <Skeleton className="size-12 shrink-0 rounded-lg" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TermList({
  copy: c,
  terms,
  total,
  initialLoading,
  loadingMore,
  hasMore,
  loadError,
  selectedId,
  onSelect,
  onShowMedia,
  onDelete,
  onRestore,
  onLoadMore,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const root = viewportRef.current;
    const trigger = loadTriggerRef.current;
    if (!root || !trigger || !hasMore || initialLoading || loadingMore || loadError) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current();
      },
      { root, rootMargin: '240px 0px' },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [hasMore, initialLoading, loadingMore, loadError, terms.length]);

  return (
    <ScrollArea viewportRef={viewportRef} data-dictionary-term-list type="always" className="min-h-0 flex-1">
      {(initialLoading || loadingMore) && !terms.length ? (
        <TermListSkeleton />
      ) : (
        <div className="space-y-1.5 px-2 pb-3">
          {terms.map((term) => {
            const selected = term.id === selectedId;
            const archived = term.editorialState === 'ARCHIVED';
            const draft = !archived && (term.hasDraft || term.editorialState === 'DRAFT');
            const hasMedia = term.mediaPreview.totalCount > 0;
            const primaryClassification = primaryTermClassification(term);
            return (
              <ContextMenu key={term.id}>
                <ContextMenuTrigger asChild>
                  <div
                    data-term-id={term.id}
                    className={cn(
                      'group relative grid w-full items-center gap-2.5 rounded-xl border border-transparent py-2.5 text-left transition-colors hover:border-border-strong hover:bg-hover',
                      'min-h-[78px] grid-cols-[62px_minmax(0,1fr)] px-2.5',
                      selected &&
                        'border-selected-border bg-selected text-selected-foreground hover:border-selected-border hover:bg-selected',
                      archived && 'opacity-55',
                    )}
                    onContextMenu={() => onSelect(term.id)}
                  >
                    {selected && (
                      <span className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-selected-foreground" />
                    )}
                    {hasMedia ? (
                      <MediaStackPreview
                        size="sm"
                        items={term.mediaPreview.items.map((item) => ({
                          asset: item.asset,
                          focalX: item.focalX,
                          focalY: item.focalY,
                        }))}
                        onAssetSelect={() => onSelect(term.id)}
                      />
                    ) : (
                      <span className="grid size-12 place-items-center rounded-lg border bg-muted text-sm font-semibold text-muted-foreground">
                        {term.title.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="flex min-w-0 flex-col gap-1">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => onSelect(term.id)}
                      >
                        <strong className="min-w-0 truncate text-sm font-semibold">{term.title}</strong>
                        {draft && (
                          <StateTag tone="neutral" className="text-lifecycle-draft" icon={<FilePenLineIcon />}>
                            {c.draft}
                          </StateTag>
                        )}
                        {archived && (
                          <StateTag tone="locked" className="text-lifecycle-archived" icon={<ArchiveIcon />}>
                            {c.archived}
                          </StateTag>
                        )}
                        <MetaText as="small" className="ml-auto shrink-0">
                          {c.citations} {term.metrics.citationCount}
                        </MetaText>
                      </button>
                      <button
                        type="button"
                        className="truncate text-left text-xs text-muted-foreground/90 hover:text-foreground"
                        onClick={() => onSelect(term.id)}
                      >
                        {term.localizations[0]?.title || term.definition || c.untested}
                      </button>
                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <button
                          type="button"
                          className="min-w-0 truncate text-left hover:text-foreground"
                          onClick={() => onSelect(term.id)}
                        >
                          V{term.revisionNo} · {primaryClassification?.name || c.untested}
                          {term.classifications.length > 1 ? ` +${term.classifications.length - 1}` : ''}
                        </button>
                        {term.mediaPreview.totalCount > 3 && (
                          <button
                            type="button"
                            className="ml-auto shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
                            onClick={() => onShowMedia(term.id)}
                          >
                            {c.moreImages} +{term.mediaPreview.totalCount - 3}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {archived ? (
                    <ContextMenuItem onSelect={() => onRestore(term)}>
                      <RotateCcwIcon />
                      {c.restore}
                    </ContextMenuItem>
                  ) : (
                    <ContextMenuItem variant="destructive" onSelect={() => onDelete(term)}>
                      <Trash2Icon />
                      {c.deleteTerm}
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {!terms.length && (
            <div className="flex flex-col items-center gap-2 px-3 py-16 text-center text-sm text-muted-foreground">
              {loadError ? (
                <button
                  type="button"
                  className="text-destructive underline-offset-4 hover:underline"
                  onClick={onLoadMore}
                >
                  {c.loadFailed}
                </button>
              ) : (
                c.noTerms
              )}
            </div>
          )}
          {Boolean(terms.length) && (
            <div
              ref={loadTriggerRef}
              className="flex min-h-16 items-center justify-center px-3 py-4 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {initialLoading || loadingMore ? (
                <StatusDot variant="pending" label={c.loadingMore} labelVisibility="visible" />
              ) : loadError ? (
                <button
                  type="button"
                  className="text-destructive underline-offset-4 hover:underline"
                  onClick={onLoadMore}
                >
                  {c.loadFailed}
                </button>
              ) : hasMore ? (
                <span>
                  {c.scrollForMore} · {terms.length} / {total}
                </span>
              ) : (
                <span>
                  {c.allLoaded} · {total} {c.rows}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </ScrollArea>
  );
}
