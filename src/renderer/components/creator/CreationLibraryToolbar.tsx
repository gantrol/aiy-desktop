import { SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export type CreationLibraryFilter = 'all' | 'images' | 'documents';

interface Props {
  query: string;
  filter: CreationLibraryFilter;
  onQueryChange(query: string): void;
  onFilterChange(filter: CreationLibraryFilter): void;
}

export function CreationLibraryToolbar({ query, filter, onQueryChange, onFilterChange }: Props) {
  const labels = useI18n().messages.creator.results;
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const searchVisible = searchOpen || Boolean(query);
  const filterActive = filter !== 'all';
  const filterValueLabel =
    filter === 'images' ? labels.filterImages : filter === 'documents' ? labels.filterDocuments : labels.filterAll;
  const filterControlLabel = `${labels.filter}: ${filterValueLabel}`;

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
      <Select value={filter} onValueChange={(value) => onFilterChange(value as CreationLibraryFilter)}>
        <SelectTrigger
          className={cn(
            'h-8 shrink-0 gap-1.5 text-xs',
            filterActive
              ? 'w-auto max-w-[9rem] border-selected-foreground/20 bg-selected px-2 text-selected-foreground hover:bg-selected'
              : 'size-8 justify-center gap-0 border-transparent bg-transparent p-0 text-muted-foreground hover:bg-hover hover:text-foreground data-[state=open]:bg-pressed [&>svg:last-child]:hidden',
          )}
          title={filterControlLabel}
          aria-label={filterControlLabel}
        >
          <SlidersHorizontalIcon className="size-4 shrink-0" />
          {filterActive && <SelectValue />}
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="all">{labels.filterAll}</SelectItem>
          <SelectItem value="images">{labels.filterImages}</SelectItem>
          <SelectItem value="documents">{labels.filterDocuments}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
