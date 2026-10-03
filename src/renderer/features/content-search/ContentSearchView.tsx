import { commandMatchesShortcut, shortcutEventAvailable } from '@/renderer/commands/app-shortcuts';
import { CollectionDetailLayout } from '@/renderer/components/workbench/CollectionDetailLayout';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';
import { ContentSearchInput } from '@/renderer/features/content-search/ContentSearchInput';
import { Button } from '@/renderer/components/ui/button';
import { ContentSearchFilters } from '@/renderer/features/content-search/ContentSearchFilters';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentSearchResultList } from '@/renderer/features/content-search/ContentSearchResults';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import type { ContentSource } from '@/shared/contracts/content-source';

type SearchItem = ContentLookupResult['items'][number];

export interface ContentSearchViewProps {
  active: boolean;
  platform: Parameters<typeof commandMatchesShortcut>[1];
  location: AppLocation['search'];
  composing: boolean;
  search: ComponentProps<typeof ContentSearchResultList>['search'];
  selection: {
    selected: SearchItem | null;
    busy: boolean;
    error: string;
    select(item: SearchItem): Promise<boolean>;
  };
  opening: {
    busy: boolean;
    error: string;
    open(source: ContentSource): Promise<void>;
  };
  onComposing(value: boolean): void;
  onNavigate(location: AppLocation['search']): void;
  renderPreview(active: boolean): ReactNode;
}

/** Shared work surface; the host owns lookup, save-before-selection and source navigation. */
export function ContentSearchView({
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
}: ContentSearchViewProps) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline.lookup;
  const { query, type } = location;
  const enabled = active && !composing;
  const firstResult = search.result?.items[0];
  const { selected } = selection;
  const selectedKey = selected ? contentSearchSourceKey(selected.source) : undefined;
  const searchRoot = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true });
  }, [active]);
  const focusSearch = () => {
    requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    });
  };
  return (
    <section
      data-content-search-screen
      className="flex size-full min-h-0 min-w-0 bg-background"
      aria-label={copy.title}
      onKeyDown={(event) => {
        if (!active || composing || event.repeat || !shortcutEventAvailable(event.nativeEvent)) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
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
        <div className="shrink-0 space-y-3 border-b p-3">
          <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <ContentSearchInput
              ref={input}
              aria-label={copy.title}
              placeholder={copy.placeholder}
              focusIndicator="container"
              className="h-10 min-w-0 rounded-none border-0 bg-transparent px-0"
              query={query}
              onQuery={(query) => onNavigate({ ...location, query })}
              onComposing={onComposing}
              onKeyDown={(event) => {
                if (composing || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey)
                  return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const results = searchRoot.current?.querySelectorAll<HTMLButtonElement>(
                    '[data-search-result]:not(:disabled)',
                  );
                  const target = event.key === 'ArrowUp' ? results?.[results.length - 1] : results?.[0];
                  if (target) {
                    event.preventDefault();
                    target.focus({ preventScroll: true });
                    target.scrollIntoView({ block: 'nearest' });
                  }
                } else if (event.key === 'Enter' && firstResult) {
                  event.preventDefault();
                  void opening.open(firstResult.source);
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
          <ContentSearchFilters value={type} onChange={(type) => onNavigate({ ...location, type })} />
        </div>
        {(opening.error || selection.error) && (
          <p role="alert" className="px-4 py-3 text-sm text-destructive">
            {opening.error || selection.error}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <CollectionDetailLayout
            layoutKey="content-search"
            collectionLabel={copy.results}
            collectionWidth={360}
            selectionKey={selectedKey ?? null}
            collection={({ toggle, wide, revealDetail }) => (
              <>
                <WorkbenchPaneHeader>
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{copy.results}</h2>
                  {toggle}
                </WorkbenchPaneHeader>
                <ContentSearchResultList
                  query={query}
                  type={type}
                  enabled={enabled}
                  disabled={composing || opening.busy}
                  search={search}
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
                  onOpen={(item) => void opening.open(item.source)}
                />
              </>
            )}
          >
            {({ toggle, visible }) => (
              <>
                <WorkbenchPaneHeader>
                  {toggle}
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {selected?.title || messages.workbench.preview}
                  </h2>
                  {selected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={opening.busy || composing || selection.busy}
                      onClick={() => void opening.open(selected.source)}
                    >
                      {messages.workbench.openSource}
                    </Button>
                  )}
                </WorkbenchPaneHeader>
                {renderPreview(active && visible)}
              </>
            )}
          </CollectionDetailLayout>
        </div>
      </div>
    </section>
  );
}
