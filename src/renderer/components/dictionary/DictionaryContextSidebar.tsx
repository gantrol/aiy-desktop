import { ArrowLeftIcon, ChevronRightIcon, ImageIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';
import type { TermListItem } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { StatusDot } from '@/renderer/components/ui/status-dot';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';

export type DictionaryContextSidebarMode = 'expanded' | 'compact';

export interface DictionaryContextBreadcrumb {
  overview: string;
  path: string[];
}

export interface DictionaryContextSidebarCopy {
  collapse: string;
  expand: string;
  backToOverview: string;
  sameCategory: string;
  initialLoading: string;
  loadingMore: string;
  loadFailed: string;
  retry: string;
  scrollForMore: string;
  allLoaded: string;
  empty: string;
  loadedCount(loaded: number, total: number): string;
}

export interface DictionaryContextSidebarProps {
  mode: DictionaryContextSidebarMode;
  breadcrumb: DictionaryContextBreadcrumb;
  copy: DictionaryContextSidebarCopy;
  terms: TermListItem[];
  total: number;
  currentTermId: string;
  initialLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadError: string;
  className?: string;
  onModeChange(mode: DictionaryContextSidebarMode): void;
  onBack(): void;
  onSelect(termId: string): void;
  onLoadMore(): void;
  notify?(message: string): void;
}

export interface DictionaryContextPaginationState {
  hasMore: boolean;
  initialLoading: boolean;
  loadingMore: boolean;
  hasError: boolean;
}

export function shouldLoadNextDictionaryContextPage(
  entryIsIntersecting: boolean,
  state: DictionaryContextPaginationState,
) {
  return entryIsIntersecting && state.hasMore && !state.initialLoading && !state.loadingMore && !state.hasError;
}

export function dictionaryContextSecondaryText(term: TermListItem) {
  return term.localizations[0]?.title.trim() || term.definition.trim();
}

function DictionaryContextSkeleton({ compact, label }: { compact: boolean; label: string }) {
  return (
    <div
      data-dictionary-context-skeleton
      role="status"
      className={cn('space-y-2', compact ? 'px-2 pt-3' : 'px-2 pt-2')}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: compact ? 7 : 6 }, (_, index) =>
        compact ? (
          <Skeleton key={index} className="mx-auto h-14 w-11 rounded-lg" />
        ) : (
          <div
            key={index}
            className="grid min-h-[70px] grid-cols-[62px_minmax(0,1fr)] items-center gap-2 rounded-xl p-2"
          >
            <Skeleton className="h-[50px] w-[62px] rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function CompactTermPreview({ term }: { term: TermListItem }) {
  const media = term.mediaPreview.items[0];
  if (!media)
    return (
      <span className="grid size-full place-items-center bg-surface-sunken text-sm font-semibold text-muted-foreground">
        {term.title.slice(0, 1).toUpperCase() || <ImageIcon className="size-4" />}
      </span>
    );
  return (
    <img
      src={media.asset.mediaUrl}
      alt=""
      draggable={false}
      className="size-full object-contain"
      style={{ objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%` }}
    />
  );
}

interface TermRowProps {
  term: TermListItem;
  current: boolean;
  notify(message: string): void;
  onSelect(termId: string): void;
}

function ExpandedTermRow({ term, current, notify, onSelect }: TermRowProps) {
  const secondary = dictionaryContextSecondaryText(term);
  return (
    <div
      data-term-id={term.id}
      data-current={current || undefined}
      className={cn(
        'relative grid min-h-[70px] w-full grid-cols-[62px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-transparent p-2 text-left outline-none transition-colors',
        'hover:border-border-strong hover:bg-hover',
        current &&
          'border-selected-border bg-selected text-selected-foreground hover:border-selected-border hover:bg-selected',
      )}
    >
      {current && (
        <span aria-hidden className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-selected-foreground" />
      )}
      {term.mediaPreview.totalCount > 0 ? (
        <MediaStackPreview
          size="sm"
          items={term.mediaPreview.items.map((item) => ({
            asset: item.asset,
            focalX: item.focalX,
            focalY: item.focalY,
          }))}
          onAssetSelect={() => onSelect(term.id)}
          notify={notify}
          revealContext={{ kind: 'TERM', termId: term.id }}
        />
      ) : (
        <span className="grid size-12 place-items-center justify-self-center rounded-lg border bg-surface-sunken text-sm font-semibold text-muted-foreground">
          {term.title.slice(0, 1).toUpperCase() || <ImageIcon className="size-4" />}
        </span>
      )}
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        className="flex min-w-0 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(term.id)}
      >
        <strong className="truncate text-sm font-semibold">{term.title}</strong>
        {secondary && <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">{secondary}</span>}
      </button>
    </div>
  );
}

function CompactTermRow({ term, current, notify, onSelect }: TermRowProps) {
  const secondary = dictionaryContextSecondaryText(term);
  const preview = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-term-id={term.id}
          data-current={current || undefined}
          aria-current={current ? 'page' : undefined}
          aria-label={term.title}
          title={term.title}
          className={cn(
            'relative mx-auto block h-14 w-11 overflow-hidden rounded-lg border-2 border-transparent bg-media-surround-light outline-none transition-colors',
            'hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            current && 'border-selected-border ring-2 ring-ring hover:border-selected-border',
          )}
          onClick={() => onSelect(term.id)}
        >
          <CompactTermPreview term={term} />
          {current && (
            <span aria-hidden className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-selected-foreground" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        <strong className="block text-xs">{term.title}</strong>
        {secondary && <span className="mt-0.5 block text-[11px] opacity-80">{secondary}</span>}
      </TooltipContent>
    </Tooltip>
  );
  const asset = term.mediaPreview.items[0]?.asset;
  return asset ? (
    <AssetFileContextMenu assetId={asset.id} notify={notify} revealContext={{ kind: 'TERM', termId: term.id }}>
      {preview}
    </AssetFileContextMenu>
  ) : (
    preview
  );
}

function BreadcrumbTrail({ breadcrumb, onBack }: { breadcrumb: DictionaryContextBreadcrumb; onBack(): void }) {
  const labels = breadcrumb.path
    .filter(Boolean)
    .filter((label, index, items) => index === 0 || label !== items[index - 1]);
  return (
    <nav aria-label={breadcrumb.overview} className="flex min-w-0 items-center gap-0.5 text-xs text-muted-foreground">
      <button
        data-action="dictionary-context-back"
        type="button"
        className="shrink-0 rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onBack}
      >
        {breadcrumb.overview}
      </button>
      {labels.map((label) => (
        <span key={label} className="flex min-w-0 items-center gap-0.5">
          <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate" title={label}>
            {label}
          </span>
        </span>
      ))}
    </nav>
  );
}

interface PaginationFooterProps {
  copy: DictionaryContextSidebarCopy;
  terms: TermListItem[];
  total: number;
  initialLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadError: string;
  compact: boolean;
  triggerRef: RefObject<HTMLDivElement | null>;
  onLoadMore(): void;
}

function PaginationFooter({
  copy,
  terms,
  total,
  initialLoading,
  loadingMore,
  hasMore,
  loadError,
  compact,
  triggerRef,
  onLoadMore,
}: PaginationFooterProps) {
  const count = copy.loadedCount(terms.length, total);
  const compactCount = `${terms.length}/${total}`;
  return (
    <div
      ref={triggerRef}
      data-dictionary-context-pagination
      className={cn(
        'flex min-h-16 items-center justify-center px-2 py-4 text-center text-xs text-muted-foreground',
        compact && 'min-h-14 px-1',
      )}
      aria-live="polite"
    >
      {initialLoading || loadingMore ? (
        <StatusDot
          variant="pending"
          label={compact ? compactCount : `${copy.loadingMore} · ${count}`}
          labelVisibility="visible"
        />
      ) : loadError ? (
        <button
          type="button"
          className="text-destructive underline-offset-4 hover:underline"
          title={loadError}
          onClick={onLoadMore}
        >
          {compact ? copy.retry : `${copy.loadFailed} · ${copy.retry}`}
        </button>
      ) : hasMore ? (
        <span title={copy.scrollForMore}>{compact ? compactCount : `${copy.scrollForMore} · ${count}`}</span>
      ) : (
        <span title={copy.allLoaded}>{compact ? compactCount : `${copy.allLoaded} · ${count}`}</span>
      )}
    </div>
  );
}

export function DictionaryContextSidebar({
  mode,
  breadcrumb,
  copy,
  terms,
  total,
  currentTermId,
  initialLoading,
  loadingMore,
  hasMore,
  loadError,
  className,
  onModeChange,
  onBack,
  onSelect,
  onLoadMore,
  notify = () => undefined,
}: DictionaryContextSidebarProps) {
  const compact = mode === 'compact';
  const viewportRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const root = viewportRef.current;
    const trigger = loadTriggerRef.current;
    if (!root || !trigger || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          shouldLoadNextDictionaryContextPage(Boolean(entry?.isIntersecting), {
            hasMore,
            initialLoading,
            loadingMore,
            hasError: Boolean(loadError),
          })
        )
          loadMoreRef.current();
      },
      { root, rootMargin: '240px 0px' },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [hasMore, initialLoading, loadingMore, loadError, terms.length]);

  return (
    <TooltipProvider>
      <aside
        data-dictionary-context-sidebar
        data-mode={mode}
        className={cn(
          'flex min-h-0 shrink-0 flex-col border-r bg-muted transition-[width] duration-200',
          compact ? 'w-16' : 'w-[280px]',
          className,
        )}
      >
        {compact ? (
          <header className="flex shrink-0 flex-col items-center gap-1 border-b border-border/60 py-2">
            <Button
              data-action="dictionary-context-back"
              type="button"
              variant="ghost"
              size="icon-sm"
              title={copy.backToOverview}
              aria-label={copy.backToOverview}
              onClick={onBack}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={copy.expand}
              aria-label={copy.expand}
              onClick={() => onModeChange('expanded')}
            >
              <PanelLeftOpenIcon className="size-4" />
            </Button>
          </header>
        ) : (
          <header className="shrink-0 border-b border-border/60 px-3 py-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <BreadcrumbTrail breadcrumb={breadcrumb} onBack={onBack} />
                <div className="mt-2 flex min-w-0 items-baseline gap-1.5">
                  <strong className="truncate text-sm font-semibold">
                    {breadcrumb.path.at(-1) || copy.sameCategory}
                  </strong>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{total}</span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={copy.collapse}
                aria-label={copy.collapse}
                onClick={() => onModeChange('compact')}
              >
                <PanelLeftCloseIcon className="size-4" />
              </Button>
            </div>
          </header>
        )}

        <ScrollArea viewportRef={viewportRef} type="always" className="min-h-0 flex-1">
          {initialLoading && !terms.length ? (
            <DictionaryContextSkeleton compact={compact} label={copy.initialLoading} />
          ) : (
            <div className={cn('pb-2', compact ? 'space-y-2 px-2 pt-3' : 'space-y-1.5 px-2 pt-2')}>
              {terms.map((term) =>
                compact ? (
                  <CompactTermRow
                    key={term.id}
                    term={term}
                    current={term.id === currentTermId}
                    notify={notify}
                    onSelect={onSelect}
                  />
                ) : (
                  <ExpandedTermRow
                    key={term.id}
                    term={term}
                    current={term.id === currentTermId}
                    notify={notify}
                    onSelect={onSelect}
                  />
                ),
              )}
              {!terms.length && !loadError && (
                <div className={cn('py-14 text-center text-xs text-muted-foreground', compact && 'px-1')}>
                  {compact ? '—' : copy.empty}
                </div>
              )}
              {(!initialLoading || Boolean(terms.length)) && (
                <PaginationFooter
                  copy={copy}
                  terms={terms}
                  total={total}
                  initialLoading={initialLoading}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  loadError={loadError}
                  compact={compact}
                  triggerRef={loadTriggerRef}
                  onLoadMore={onLoadMore}
                />
              )}
            </div>
          )}
        </ScrollArea>
      </aside>
    </TooltipProvider>
  );
}
