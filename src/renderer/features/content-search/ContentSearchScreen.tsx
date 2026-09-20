import { useEffect, useRef, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';
import { ContentSearchInput } from '@/renderer/features/content-search/ContentSearchInput';
import { Button } from '@/renderer/components/ui/button';
import { ContentSearchFilters } from '@/renderer/features/content-search/ContentSearchFilters';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentSearchResultList } from '@/renderer/features/content-search/ContentSearchResults';
import { useContentLookup } from '@/renderer/features/content-search/useContentLookup';
import { useContentSearchOpen } from '@/renderer/features/content-search/useContentSearchOpen';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import type { ContentSource } from '@/shared/contracts/content-source';

export default function ContentSearchScreen({
  active,
  location,
  onNavigate,
  onOpen,
}: {
  active: boolean;
  location: AppLocation['search'];
  onNavigate(location: AppLocation['search']): void;
  onOpen(source: ContentSource): void;
}) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline.lookup;
  const { query, type } = location;
  const context = JSON.stringify([query, type]);
  const [composing, setComposing] = useState(false);
  const enabled = active && !composing;
  const search = useContentLookup(contentLibraryApi(), query, type, enabled);
  const items = search.result?.items;
  const firstResult = items?.[0];
  const opening = useContentSearchOpen(active, context, copy.notAvailable, onOpen);
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
        if (event.defaultPrevented || !active || composing || event.nativeEvent.isComposing || event.altKey) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          event.stopPropagation();
          focusSearch();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          if (event.target === input.current && query) onNavigate({ ...location, query: '' });
          else focusSearch();
        }
      }}
    >
      <div ref={searchRoot} className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-2 px-4 py-2">
          <h1 className="text-sm font-semibold">{messages.app.navigation.search}</h1>
        </header>
        <div className="shrink-0 space-y-3 border-b px-3 pb-3">
          <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 focus-within:ring-1 focus-within:ring-border-strong">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <ContentSearchInput
              ref={input}
              aria-label={copy.title}
              placeholder={copy.placeholder}
              className="h-10 min-w-0 rounded-none border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              query={query}
              onQuery={(query) => onNavigate({ ...location, query })}
              onComposing={setComposing}
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
                className="-mr-1 text-muted-foreground"
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
        {opening.error && (
          <p role="alert" className="px-4 py-3 text-sm text-destructive">
            {opening.error}
          </p>
        )}
        <ContentSearchResultList
          query={query}
          type={type}
          enabled={enabled}
          disabled={composing || opening.busy}
          search={search}
          onSelect={(item) => void opening.open(item.source)}
        />
      </div>
    </section>
  );
}
