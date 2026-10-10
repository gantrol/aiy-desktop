import { commandMatchesShortcut, shortcutEventAvailable } from '@/renderer/commands/app-shortcuts';
import {
  CollectionDetailLayout,
  type CollectionDetailLayoutHandle,
} from '@/renderer/components/workbench/CollectionDetailLayout';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ExternalLinkIcon, SearchIcon, XIcon } from 'lucide-react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';
import { ContentSearchInput } from '@/renderer/features/content-search/ContentSearchInput';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { ContentSearchFilters } from '@/renderer/features/content-search/ContentSearchFilters';
import { useContentSearchFilterFocus } from '@/renderer/features/content-search/useContentSearchFilterFocus';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentSearchResultList, type SearchListState } from '@/renderer/features/content-search/ContentSearchResults';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import type { ContentSource } from '@/shared/contracts/content-source';

type SearchItem = ContentLookupResult['items'][number];

export interface ContentSearchViewProps<T = SearchItem> {
  active: boolean;
  platform: Parameters<typeof commandMatchesShortcut>[1];
  location: AppLocation['search'];
  composing: boolean;
  search: SearchListState<T>;
  selection: {
    selected: T | null;
    selectedQuery?: string;
    busy: boolean;
    error: string;
    select(item: T): Promise<boolean>;
  };
  opening: {
    busy: boolean;
    error: string;
    open(source: ContentSource, query?: string): Promise<void>;
  };
  onComposing(value: boolean): void;
  onNavigate(location: AppLocation['search']): void;
  renderPreview(active: boolean): ReactNode;
  itemKey?(item: T): string;
  onOpenItem?(item: T, query: string): void;
  renderRow?: ComponentProps<typeof ContentSearchResultList<T>>['renderRow'];
  toolbar?: ReactNode;
  emptyAction?: ReactNode;
  status?: ReactNode;
  placeholder?: string;
  errorMessage?: string;
  openLabel?: string;
}

/** Shared work surface; the host owns lookup, save-before-selection and source navigation. */
export function ContentSearchView<T = SearchItem>({
  active,
  platform,
  location,
  composing,
  search,
  selection,
  opening,
  onComposing,
  onNavigate,
  renderPreview,
  itemKey = (item) => contentSearchSourceKey((item as SearchItem).source),
  onOpenItem = (item, query) => void opening.open((item as SearchItem).source, query),
  renderRow,
  toolbar,
  emptyAction,
  status,
  placeholder,
  errorMessage,
  openLabel,
}: ContentSearchViewProps<T>) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline.lookup;
  const { query, type } = location;
  const enabled = active && !composing;
  const firstResult = search.result?.items[0];
  const { selected } = selection;
  const selectedKey = selected ? itemKey(selected) : undefined;
  const searchRoot = useRef<HTMLDivElement>(null);
  const layout = useRef<CollectionDetailLayoutHandle>(null);
  const [toggleHost, setToggleHost] = useState<HTMLDivElement | null>(null);
  const filters = useContentSearchFilterFocus();
  const input = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const focusFrame = useRef<number | null>(null);
  const focusSearch = useCallback(() => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    });
  }, []);
  useEffect(() => {
    if (active) {
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        const target = lastFocus.current?.isConnected ? lastFocus.current : input.current;
        target?.focus({ preventScroll: true });
      });
    }
    return () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, [active]);
  return (
    <section
      data-content-search-screen
      className="flex size-full min-h-0 min-w-0 bg-background"
      aria-label={copy.title}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) lastFocus.current = event.target;
      }}
      onKeyDown={(event) => {
        if (!active || composing || event.repeat || !shortcutEventAvailable(event.nativeEvent)) return;
        if (
          !event.currentTarget.contains(event.target as Node) &&
          !filters.root.current?.contains(event.target as Node)
        )
          return;
        if (
          (event.target as Element).closest('[data-search-editor]') &&
          !commandMatchesShortcut(event.nativeEvent, platform, 'app.search')
        )
          return;
        if (
          commandMatchesShortcut(event.nativeEvent, platform, 'document.find') ||
          commandMatchesShortcut(event.nativeEvent, platform, 'app.search')
        ) {
          event.preventDefault();
          event.stopPropagation();
          focusSearch();
        } else if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          if (event.target === input.current && query) onNavigate({ ...location, query: '' });
          else focusSearch();
        }
      }}
    >
      <div ref={searchRoot} className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
        {(opening.error || selection.error) && (
          <p role="alert" className="px-4 py-3 text-sm text-destructive">
            {opening.error || selection.error}
          </p>
        )}
        <CollectionDetailLayout
          ref={layout}
          layoutKey="content-search"
          collectionLabel={copy.results}
          collectionWidth={360}
          toolbarPlacement="full"
          selectionKey={selectedKey ?? null}
          toggleHost={toggleHost}
          collectionHeader={({ visible, wide }) =>
            wide && visible ? (
              <div {...filters.controlProps} className="flex min-w-0 flex-1 items-center">
                <ContentSearchFilters value={type} onChange={(type) => onNavigate({ ...location, type })} />
              </div>
            ) : null
          }
          toolbar={({ visible, wide }) => (
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2 border-b px-3 py-1.5">
                <div ref={setToggleHost} className="flex shrink-0 empty:hidden" />
                {(!wide || !visible) && (
                  <div {...filters.controlProps} className="flex shrink-0 items-center">
                    <ContentSearchFilters compact value={type} onChange={(type) => onNavigate({ ...location, type })} />
                  </div>
                )}
                <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-sunken px-2 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
                  <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <ContentSearchInput
                    ref={input}
                    aria-label={copy.title}
                    placeholder={placeholder ?? copy.placeholder}
                    focusIndicator="container"
                    className="h-8 min-w-0 rounded-none border-0 bg-transparent px-0"
                    query={query}
                    onQuery={(query) => onNavigate({ ...location, query })}
                    onComposing={onComposing}
                    onKeyDown={(event) => {
                      if (composing || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey)
                        return;
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        if (search.result?.items.length) {
                          event.preventDefault();
                          layout.current?.revealCollection();
                          if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
                          const last = event.key === 'ArrowUp';
                          focusFrame.current = requestAnimationFrame(() => {
                            focusFrame.current = null;
                            const results = searchRoot.current?.querySelectorAll<HTMLButtonElement>(
                              '[data-search-result]:not(:disabled)',
                            );
                            const target = last ? results?.[results.length - 1] : results?.[0];
                            target?.focus({ preventScroll: true });
                            target?.scrollIntoView({ block: 'nearest' });
                          });
                        }
                      } else if (event.key === 'Enter' && firstResult) {
                        event.preventDefault();
                        onOpenItem(firstResult, query);
                      }
                    }}
                  />
                  {query && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={copy.clear}
                      disabled={composing}
                      className="-mr-1 text-muted-foreground hover:bg-hover-strong hover:text-foreground"
                      onClick={() => {
                        onNavigate({ ...location, query: '' });
                        input.current?.focus();
                      }}
                    >
                      <XIcon aria-hidden="true" className="size-3.5" />
                    </Button>
                  )}
                </div>
                {selected && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={openLabel ?? messages.workbench.openSource}
                          disabled={opening.busy || composing || selection.busy}
                          onClick={() => onOpenItem(selected, selection.selectedQuery ?? query)}
                        >
                          <ExternalLinkIcon aria-hidden="true" className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{openLabel ?? messages.workbench.openSource}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {toolbar}
              </div>
            </div>
          )}
          collection={({ visible, wide, revealDetail }) => (
            <ContentSearchResultList
              query={query}
              type={type === 'IMAGE' ? 'ALL' : type}
              enabled={enabled && visible}
              disabled={composing || opening.busy}
              search={search}
              itemKey={itemKey}
              renderRow={renderRow}
              emptyAction={emptyAction}
              status={status}
              errorMessage={errorMessage}
              selectedKey={selectedKey}
              onSelect={(item) => {
                void selection.select(item).then((selected) => {
                  if (selected) revealDetail();
                });
              }}
              onPreview={
                wide
                  ? (item) => {
                      void selection.select(item);
                    }
                  : undefined
              }
              onOpen={(item) => onOpenItem(item, query)}
            />
          )}
        >
          {({ visible }) => renderPreview(active && visible)}
        </CollectionDetailLayout>
      </div>
    </section>
  );
}
