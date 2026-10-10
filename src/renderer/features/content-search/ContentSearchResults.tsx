import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useContentLookup } from '@/renderer/features/content-search/useContentLookup';
import { ContentSearchResultRow } from '@/renderer/features/content-search/ContentSearchResultRow';
import { ContentSearchStatus } from '@/renderer/features/content-search/ContentSearchStatus';
import type { ContentLookupInput, ContentLookupResult } from '@/shared/contracts/content-search';
import { contentSearchTerms } from '@/shared/content-search-highlights';
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';

type ContentItem = ContentLookupResult['items'][number];
export type SearchListState<T> = Omit<ReturnType<typeof useContentLookup>, 'result'> & {
  result: (Omit<ContentLookupResult, 'items'> & { items: T[] }) | null;
  statusCoverage?: ContentLookupResult['coverage'];
  statusKind?: 'IMAGE_TEXT' | 'CONTENT_AND_IMAGE_TEXT';
};
type ResultsProps<T = ContentItem> = {
  query: string;
  type?: ContentLookupInput['type'];
  disabled?: boolean;
  selectedKey?: string;
  onPreview?(item: T): void;
  onOpen?(item: T): void;
  enabled?: boolean;
  onSelect(item: T): void;
  renderRow?(
    item: T,
    options: { disabled: boolean; selected: boolean; onSelect(): void; onPreview?(): void; onOpen?(): void },
  ): ReactNode;
  itemKey?(item: T): string;
  emptyAction?: ReactNode;
  status?: ReactNode;
  errorMessage?: string;
};

/** Embedded pickers own their lookup; the search screen passes one shared with its toolbar and status. */
export function ContentSearchResults(props: ResultsProps) {
  const search = useContentLookup(contentLibraryApi(), props.query, props.type ?? 'ALL', props.enabled ?? true);
  return <ContentSearchResultList {...props} search={search} />;
}

export function ContentSearchResultList<T = ContentItem>({
  query,
  disabled,
  enabled = true,
  onSelect,
  selectedKey,
  onPreview,
  onOpen,
  search,
  renderRow,
  itemKey = (item) => contentSearchSourceKey((item as ContentItem).source),
  emptyAction,
  status,
  errorMessage,
}: ResultsProps<T> & { search: SearchListState<T> }) {
  const copy = useI18n().messages.referenceOutline.lookup;
  const terms = useMemo(() => contentSearchTerms(query), [query]);
  const { result, busy, error, hasMore, more, loadingMore } = search;
  const inactive = Boolean(disabled || !enabled);
  const empty = !error && result && !result.items.length;
  const waiting = !error && !result;
  const scrollRoot = useRef<HTMLDivElement>(null);
  const loadMoreSentinel = useRef<HTMLDivElement>(null);
  const continuationFocus = useRef<number | null>(null);
  useEffect(() => {
    if (scrollRoot.current) scrollRoot.current.scrollTop = 0;
    continuationFocus.current = null;
  }, [search.key]);
  useEffect(() => {
    const root = scrollRoot.current;
    const sentinel = loadMoreSentinel.current;
    if (!root || !sentinel || inactive || busy || error || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) more();
      },
      { root, rootMargin: '0px 0px 120px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [inactive, busy, error, hasMore, more]);
  useEffect(() => {
    const index = continuationFocus.current;
    if (index === null || busy || !result || result.items.length <= index) return;
    continuationFocus.current = null;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== loadMoreSentinel.current?.querySelector('button')
    )
      return;
    const target = scrollRoot.current?.querySelectorAll<HTMLButtonElement>('[data-search-result]')[index];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [busy, result]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={copy.title} aria-busy={busy && !result}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <h2 className="text-xs font-medium text-muted-foreground">{query.trim() ? copy.results : copy.RECENT}</h2>
        {result && (
          <span className="text-2xs tabular-nums text-muted-foreground">{copy.shown(result.items.length)}</span>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-my-1 -mr-2 ml-auto text-muted-foreground"
                disabled={inactive || busy}
                aria-label={copy.retry}
                onClick={search.refresh}
              >
                <RefreshCwIcon aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{copy.retry}</p>
              {result && <p>{copy.progress(result.coverage.ready, result.coverage.total)}</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {errorMessage ?? (error.includes('SEARCH_QUERY_INVALID') ? copy.invalid : copy.failure)}
        </p>
      )}
      <div
        ref={scrollRoot}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2"
        role="list"
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return;
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-search-result]:not(:disabled)'),
          ];
          const index = buttons.findIndex((button) => button === event.target);
          if (index < 0) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
          buttons[next]?.focus({ preventScroll: true });
          buttons[next]?.scrollIntoView({ block: 'nearest' });
        }}
      >
        {result?.items.map((item) =>
          renderRow ? (
            <Fragment key={itemKey(item)}>
              {renderRow(item, {
                disabled: inactive,
                selected: selectedKey === itemKey(item),
                onSelect: () => onSelect(item),
                onPreview: onPreview ? () => onPreview(item) : undefined,
                onOpen: onOpen ? () => onOpen(item) : undefined,
              })}
            </Fragment>
          ) : (
            <ContentSearchResultRow
              key={itemKey(item)}
              item={item as ContentItem}
              terms={terms}
              disabled={inactive}
              onSelect={() => onSelect(item)}
              selected={selectedKey === itemKey(item)}
              onPreview={onPreview ? () => onPreview(item) : undefined}
              onOpen={onOpen ? () => onOpen(item) : undefined}
            />
          ),
        )}
        {waiting && !search.paused && (
          <div aria-hidden="true" className="space-y-6 px-3 py-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex gap-3">
                <Skeleton className="size-4 shrink-0 rounded-sm motion-reduce:animate-none" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-3.5 w-2/5 rounded-sm motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-4/5 rounded-sm motion-reduce:animate-none" />
                  <Skeleton className="h-2.5 w-1/4 rounded-sm motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        )}
        {empty && (
          <div
            role="status"
            className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-muted-foreground"
          >
            <SearchIcon aria-hidden="true" className="size-6" strokeWidth={1.5} />
            <span className="text-sm">
              {result.coverage.pending || result.coverage.unavailable || result.coverage.limited
                ? copy.partialEmpty
                : copy.empty}
            </span>
            {emptyAction}
          </div>
        )}
        {(hasMore || loadingMore) && (
          <div ref={loadMoreSentinel} className="flex min-h-1 shrink-0 justify-center" role="listitem">
            {loadingMore && (
              <span role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
                {copy.loadingMore}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={inactive}
              aria-disabled={busy}
              className={error ? undefined : 'sr-only focus:not-sr-only'}
              onClick={(event) => {
                if (busy) return;
                if (document.activeElement === event.currentTarget)
                  continuationFocus.current = result?.items.length ?? 0;
                more();
              }}
            >
              {error ? copy.retryMore : copy.loadMore}
            </Button>
          </div>
        )}
      </div>
      <ContentSearchStatus
        result={result ? { ...result, items: [] } : null}
        statusCoverage={search.statusCoverage}
        statusKind={search.statusKind}
        busy={busy}
        paused={search.paused}
        disabled={inactive}
        onPause={search.pause}
      />
      {status}
    </section>
  );
}
