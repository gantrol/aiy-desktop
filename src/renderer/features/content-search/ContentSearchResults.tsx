import { ArrowLeftIcon, ArrowRightIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useContentLookup } from '@/renderer/features/content-search/useContentLookup';
import { ContentSearchResultRow } from '@/renderer/features/content-search/ContentSearchResultRow';
import { ContentSearchStatus } from '@/renderer/features/content-search/ContentSearchStatus';
import type { ContentLookupInput, ContentLookupResult } from '@/shared/contracts/content-search';
import { contentSearchTerms } from '@/shared/content-search-highlights';
import { useEffect, useMemo, useRef } from 'react';

type ResultsProps = {
  query: string;
  type?: ContentLookupInput['type'];
  disabled?: boolean;
  enabled?: boolean;
  onSelect(item: ContentLookupResult['items'][number]): void;
};

/** Embedded pickers own their lookup; the search screen passes one shared with its toolbar and status. */
export function ContentSearchResults(props: ResultsProps) {
  const search = useContentLookup(contentLibraryApi(), props.query, props.type ?? 'ALL', props.enabled ?? true);
  return <ContentSearchResultList {...props} search={search} />;
}

export function ContentSearchResultList({
  query,
  disabled,
  enabled = true,
  onSelect,
  search,
}: ResultsProps & { search: ReturnType<typeof useContentLookup> }) {
  const copy = useI18n().messages.referenceOutline.lookup;
  const terms = useMemo(() => contentSearchTerms(query), [query]);
  const { result, busy, error } = search;
  const inactive = Boolean(disabled || !enabled);
  const canPage = search.canPage && !error;
  const empty = !busy && !error && result && !result.coverage.pending && !result.items.length;
  const waiting = !error && (!result || (result.coverage.pending > 0 && !result.items.length));
  const scrollRoot = useRef<HTMLDivElement>(null);
  const pageFocus = useRef(false);
  useEffect(() => {
    if (scrollRoot.current) scrollRoot.current.scrollTop = 0;
  }, [search.key]);
  useEffect(() => {
    if (!busy && result && pageFocus.current) {
      pageFocus.current = false;
      if (document.activeElement === document.body || document.activeElement?.closest('[data-search-pagination]'))
        scrollRoot.current
          ?.querySelector<HTMLButtonElement>('[data-search-result]:not(:disabled)')
          ?.focus({ preventScroll: true });
    }
  }, [busy, result]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={copy.title} aria-busy={busy}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <h2 className="text-xs font-medium text-muted-foreground">{query.trim() ? copy.results : copy.RECENT}</h2>
        {result && (
          <span className="text-2xs tabular-nums text-muted-foreground">{copy.shown(result.items.length)}</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="-my-1 -mr-2 ml-auto text-muted-foreground"
          disabled={inactive || busy}
          aria-label={copy.retry}
          title={copy.retry}
          onClick={search.refresh}
        >
          <RefreshCwIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {error.includes('SEARCH_QUERY_INVALID') ? copy.invalid : copy.failure}
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
        {result?.items.map((item) => (
          <ContentSearchResultRow
            key={JSON.stringify([item.source.kind, item.source.id, item.source.branchId])}
            item={item}
            terms={terms}
            disabled={inactive}
            onSelect={onSelect}
          />
        ))}
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
              {result.coverage.unavailable || result.coverage.limited ? copy.partialEmpty : copy.empty}
            </span>
          </div>
        )}
      </div>
      {canPage && (
        <div
          data-search-pagination
          className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2 text-xs"
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={inactive || busy || !search.hasPrevious}
            onClick={() => {
              pageFocus.current = true;
              search.previous();
            }}
          >
            <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
            {copy.previous}
          </Button>
          <span className="text-muted-foreground tabular-nums">{copy.page(search.page)}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={inactive || busy || !result || result.nextOffset === null}
            onClick={() => {
              pageFocus.current = true;
              search.more();
            }}
          >
            {copy.more}
            <ArrowRightIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      )}
      <ContentSearchStatus
        result={result}
        busy={busy}
        paused={search.paused}
        disabled={inactive}
        onPause={search.pause}
      />
    </section>
  );
}
