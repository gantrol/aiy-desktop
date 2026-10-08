import { ArrowLeftIcon, SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { CreationLibraryFilterMenu } from '@/renderer/components/creator/CreationLibraryFilterMenu';
import { CreationLibrarySearchButton } from '@/renderer/components/creator/CreationLibrarySearchButton';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';
import type { CreationLibraryAuthorOption } from '@/renderer/components/creator/creationLibraryAuthorFilter';

interface Props {
  searchOpen: boolean;
  onSearchOpenChange(open: boolean): void;
  query: string;
  filter: CreationLibraryFilter;
  onQueryChange(query: string): void;
  onFilterChange(filter: CreationLibraryFilter): void;
  authors?: readonly CreationLibraryAuthorOption[];
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function CreationLibraryToolbar({
  searchOpen,
  onSearchOpenChange: setSearchOpen,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  authors,
  inputRef,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const exitSearchLabel = labels.exitSearch;
  const searchVisible = searchOpen || Boolean(query);
  const searchButton = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);
  useEffect(() => {
    if (!searchVisible && restoreSearchFocus.current) {
      restoreSearchFocus.current = false;
      searchButton.current?.focus({ preventScroll: true });
    }
  }, [searchVisible]);

  function closeSearch() {
    restoreSearchFocus.current = true;
    onQueryChange('');
    setSearchOpen(false);
  }

  const filterMenu = <CreationLibraryFilterMenu filter={filter} onFilterChange={onFilterChange} authors={authors} />;

  if (!searchVisible) {
    return (
      <>
        <CreationLibrarySearchButton ref={searchButton} onClick={() => setSearchOpen(true)} />
        {filterMenu}
      </>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex min-w-0 items-center gap-1 bg-surface-sunken">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        title={exitSearchLabel}
        aria-label={exitSearchLabel}
        onClick={closeSearch}
      >
        <ArrowLeftIcon className="size-4" />
      </Button>
      <label className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          autoFocus
          value={query}
          className="h-8 pr-8 pl-8 text-xs focus-visible:border-ring"
          placeholder={labels.searchPlaceholder}
          aria-label={labels.search}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            if (query) onQueryChange('');
            else closeSearch();
          }}
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2"
            title={labels.clearSearch}
            aria-label={labels.clearSearch}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onQueryChange('')}
          >
            <XIcon className="size-3.5" />
          </Button>
        )}
      </label>
      {filterMenu}
    </div>
  );
}
