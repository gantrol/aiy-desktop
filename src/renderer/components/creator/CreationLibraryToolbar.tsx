import { ArrowLeftIcon, SearchIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { CreationLibraryFilterMenu } from '@/renderer/components/creator/CreationLibraryFilterMenu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';

interface Props {
  searchOpen: boolean;
  onSearchOpenChange(open: boolean): void;
  query: string;
  filter: CreationLibraryFilter;
  onQueryChange(query: string): void;
  onFilterChange(filter: CreationLibraryFilter): void;
}

export function CreationLibraryToolbar({
  searchOpen,
  onSearchOpenChange: setSearchOpen,
  query,
  filter,
  onQueryChange,
  onFilterChange,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const exitSearchLabel = labels.exitSearch;
  const searchVisible = searchOpen || Boolean(query);

  function closeSearch() {
    onQueryChange('');
    setSearchOpen(false);
  }

  const filterMenu = <CreationLibraryFilterMenu filter={filter} onFilterChange={onFilterChange} />;

  if (!searchVisible) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          title={labels.search}
          aria-label={labels.search}
          onClick={() => setSearchOpen(true)}
        >
          <SearchIcon className="size-4" />
        </Button>
        {filterMenu}
      </>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center gap-1 bg-surface-sunken px-3">
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
          autoFocus
          value={query}
          className="h-8 pr-8 pl-8 text-xs focus-visible:border-ring"
          placeholder={labels.searchPlaceholder}
          aria-label={labels.search}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            if (query) onQueryChange('');
            else setSearchOpen(false);
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
