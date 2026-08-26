import { CheckIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  allCreationLibraryFilters,
  isAllCreationLibraryFilter,
  type CreationLibraryFilter,
} from '@/renderer/components/creator/creationLibraryFilter';

interface Props {
  query: string;
  filter: CreationLibraryFilter;
  onQueryChange(query: string): void;
  onFilterChange(filter: CreationLibraryFilter): void;
}

export function CreationLibraryToolbar({ query, filter, onQueryChange, onFilterChange }: Props) {
  const { locale, messages } = useI18n();
  const labels = messages.creator.results;
  const inspirationLabel = locale === 'zh' ? '灵感' : labels.filterInspirations;
  const socialPostLabel = locale === 'zh' ? '贴图' : 'Social posts';
  const articleLabel = locale === 'zh' ? '文章' : 'Articles';
  const emptyFilterLabel = locale === 'zh' ? '无' : labels.filterNone;
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const searchVisible = searchOpen || Boolean(query);
  const filterActive = !isAllCreationLibraryFilter(filter);
  const selectedFilterLabels = [
    ...(filter.images ? [labels.filterImages] : []),
    ...(filter.documents ? [labels.filterDocuments] : []),
    ...(filter.articles ? [articleLabel] : []),
    ...(filter.socialPosts ? [socialPostLabel] : []),
    ...(filter.inspirations ? [inspirationLabel] : []),
  ];
  const filterValueLabel = filterActive
    ? selectedFilterLabels.length
      ? selectedFilterLabels.join(', ')
      : emptyFilterLabel
    : labels.filterAll;
  const filterControlLabel = `${labels.filter}: ${filterValueLabel}`;

  function toggleFilter(key: keyof CreationLibraryFilter, checked: boolean) {
    onFilterChange({ ...filter, [key]: checked });
  }

  return (
    <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-border/60 px-3">
      {searchVisible ? (
        <label className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="h-8 pr-8 pl-8 text-xs focus-visible:border-ring"
            placeholder={labels.searchPlaceholder}
            aria-label={labels.search}
            onBlur={(event) => {
              if (!event.currentTarget.value) setSearchOpen(false);
            }}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              onQueryChange('');
              setSearchOpen(false);
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
      ) : (
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
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={filterActive ? 'secondary' : 'ghost'}
            size={filterActive ? 'sm' : 'icon-sm'}
            className={cn(
              'h-8 shrink-0 gap-1.5 text-xs',
              filterActive && 'max-w-[9rem] bg-selected px-2 text-selected-foreground hover:bg-selected',
            )}
            title={filterControlLabel}
            aria-label={filterControlLabel}
          >
            <SlidersHorizontalIcon className="size-4 shrink-0" />
            {filterActive && <span className="truncate">{filterValueLabel}</span>}
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
              ['images', labels.filterImages],
              ['documents', labels.filterDocuments],
              ['articles', articleLabel],
              ['socialPosts', socialPostLabel],
              ['inspirations', inspirationLabel],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-hover focus-within:bg-hover"
            >
              <Checkbox
                checked={filter[key]}
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
