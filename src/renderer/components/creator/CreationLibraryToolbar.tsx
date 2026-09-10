import { ArrowLeftIcon, CheckIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  allCreationLibraryFilters,
  isAllCreationLibraryFilter,
  type CreationLibraryFilter,
} from '@/renderer/components/creator/creationLibraryFilter';

interface Props {
  searchOpen: boolean;
  onSearchOpenChange(open: boolean): void;
  query: string;
  filter: CreationLibraryFilter;
  onQueryChange(query: string): void;
  onFilterChange(filter: CreationLibraryFilter): void;
}

type FilterControlKey = keyof CreationLibraryFilter | 'manuscripts';

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
  const kinds = messages.creator.album.formKinds;
  const inspirationLabel = kinds.INSPIRATION;
  const manuscriptLabel = messages.creator.manuscriptEditor.kind;
  const evaluationLabel = kinds.EVALUATION_SUITE;
  const emptyFilterLabel = labels.filterNone;
  const exitSearchLabel = labels.exitSearch;
  const searchVisible = searchOpen || Boolean(query);
  const filterActive = !isAllCreationLibraryFilter(filter);
  const selectedFilterLabels = [
    ...(filter.animations ? [kinds.ANIMATION] : []),
    ...(filter.images ? [labels.filterImages] : []),
    ...(filter.documents ? [labels.filterDocuments] : []),
    ...(filter.articles || filter.socialPosts ? [manuscriptLabel] : []),
    ...(filter.inspirations ? [inspirationLabel] : []),
    ...(filter.evaluations ? [evaluationLabel] : []),
  ];
  const filterValueLabel = filterActive
    ? selectedFilterLabels.length
      ? selectedFilterLabels.join(', ')
      : emptyFilterLabel
    : labels.filterAll;
  const filterControlLabel = `${labels.filter}: ${filterValueLabel}`;

  function toggleFilter(key: FilterControlKey, checked: boolean) {
    if (key === 'manuscripts') {
      onFilterChange({ ...filter, articles: checked, socialPosts: checked });
      return;
    }
    onFilterChange({ ...filter, [key]: checked });
  }

  function filterChecked(key: FilterControlKey) {
    return key === 'manuscripts' ? filter.articles && filter.socialPosts : filter[key];
  }

  function closeSearch() {
    onQueryChange('');
    setSearchOpen(false);
  }

  if (!searchVisible) {
    const triggerLabel = filterActive ? `${labels.search} · ${filterControlLabel}` : labels.search;
    return (
      <Button
        type="button"
        variant={filterActive ? 'secondary' : 'ghost'}
        size="icon-sm"
        className="relative text-muted-foreground hover:text-foreground"
        title={triggerLabel}
        aria-label={triggerLabel}
        onClick={() => setSearchOpen(true)}
      >
        <SearchIcon className="size-4" />
        {filterActive && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-selected-foreground"
          />
        )}
      </Button>
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
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={filterActive ? 'secondary' : 'ghost'}
            size="icon-sm"
            className="h-8 shrink-0"
            title={filterControlLabel}
            aria-label={filterControlLabel}
          >
            <SlidersHorizontalIcon className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1.5">
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-hover focus-visible:bg-hover"
            onClick={() => onFilterChange({ ...allCreationLibraryFilters })}
          >
            <span
              aria-hidden="true"
              className="grid size-4 shrink-0 place-items-center rounded-[4px] border border-input"
            >
              {isAllCreationLibraryFilter(filter) && <CheckIcon className="size-3" />}
            </span>
            <span>{labels.filterAll}</span>
          </button>
          {(
            [
              ['animations', kinds.ANIMATION],
              ['images', labels.filterImages],
              ['documents', labels.filterDocuments],
              ['manuscripts', manuscriptLabel],
              ['inspirations', inspirationLabel],
              ['evaluations', evaluationLabel],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-hover focus-within:bg-hover"
            >
              <Checkbox
                checked={filterChecked(key)}
                aria-label={label}
                onCheckedChange={(checked) => toggleFilter(key, checked === true)}
              />
              <span>{label}</span>
            </label>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
