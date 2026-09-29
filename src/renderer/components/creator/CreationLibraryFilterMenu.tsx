import { CrosshairIcon, SlidersHorizontalIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CreationLibraryAuthorSelect } from '@/renderer/components/creator/CreationLibraryAuthorSelect';
import type { CreationLibraryAuthorOption } from '@/renderer/components/creator/creationLibraryAuthorFilter';
import {
  allCreationLibraryFilters,
  emptyCreationLibraryFilters,
  isAllCreationLibraryFilter,
  isAllCreationLibraryTypes,
  type CreationLibraryFilter,
  type CreationLibraryTypeFilter,
} from '@/renderer/components/creator/creationLibraryFilter';

interface Props {
  filter: CreationLibraryFilter;
  onFilterChange(filter: CreationLibraryFilter): void;
  authors?: readonly CreationLibraryAuthorOption[];
}

interface FilterOption {
  keys: (keyof CreationLibraryTypeFilter)[];
  label: string;
}

export function CreationLibraryFilterMenu({ filter, onFilterChange, authors = [] }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const kinds = messages.creator.album.formKinds;
  const options: FilterOption[] = [
    { keys: ['animations'], label: kinds.ANIMATION },
    { keys: ['images'], label: labels.filterImages },
    { keys: ['documents'], label: labels.filterDocuments },
    { keys: ['articles', 'socialPosts'], label: messages.creator.manuscriptEditor.kind },
    { keys: ['outlines'], label: kinds.OUTLINE },
    { keys: ['inspirations'], label: kinds.INSPIRATION },
    { keys: ['evaluations'], label: kinds.EVALUATION_SUITE },
  ];
  const allSelected = isAllCreationLibraryTypes(filter);
  const selectedOptions = options.filter(({ keys }) => keys.some((key) => filter[key]));
  const noneSelected = selectedOptions.length === 0;
  const valueLabel = allSelected
    ? labels.filterAll
    : noneSelected
      ? labels.filterNone
      : selectedOptions.map(({ label }) => label).join(', ');
  const authorLabel =
    filter.author === 'UNASSIGNED'
      ? labels.filterAuthorUnconfirmed
      : authors.find((author) => author.value === filter.author)?.label;
  const controlLabel = `${labels.filter}: ${valueLabel}${filter.author && filter.author !== 'ALL' ? ` · ${labels.filterAuthor}: ${authorLabel ?? labels.filterAuthorUnavailable}` : ''}`;

  function updateOption(keys: FilterOption['keys'], checked: boolean, only = false) {
    const next = { ...filter, ...(only ? emptyCreationLibraryFilters : {}) };
    for (const key of keys) next[key] = checked;
    onFilterChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={isAllCreationLibraryFilter(filter) ? 'ghost' : 'secondary'}
          size="icon-sm"
          className="h-8 shrink-0"
          title={controlLabel}
          aria-label={controlLabel}
        >
          <SlidersHorizontalIcon className="size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-label={labels.filter}
        className="w-52 max-w-[calc(100vw-16px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain p-1"
      >
        <div className="mb-1 flex items-center border-b border-border pb-1">
          <label className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 text-xs hover:bg-hover focus-within:bg-hover">
            <Checkbox
              checked={allSelected ? true : noneSelected ? false : 'indeterminate'}
              aria-label={labels.filterSelectAll}
              onCheckedChange={(checked) =>
                onFilterChange({
                  ...filter,
                  ...(checked === true ? allCreationLibraryFilters : emptyCreationLibraryFilters),
                })
              }
            />
            <span>{labels.filterSelectAll}</span>
          </label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="rounded-sm px-2 font-normal text-muted-foreground"
            disabled={noneSelected}
            onClick={() => onFilterChange({ ...filter, ...emptyCreationLibraryFilters })}
          >
            {labels.filterClear}
          </Button>
        </div>
        {options.map(({ keys, label }) => {
          const checked = keys.every((key) => filter[key])
            ? true
            : keys.some((key) => filter[key])
              ? 'indeterminate'
              : false;
          return (
            <div
              key={keys[0]}
              className="group/filter-option flex items-center rounded-sm hover:bg-hover focus-within:bg-hover"
            >
              <label className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-xs">
                <Checkbox
                  checked={checked}
                  aria-label={label}
                  onCheckedChange={(value) => updateOption(keys, value === true)}
                />
                <span className="truncate" title={label}>
                  {label}
                </span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="pointer-events-none size-7 rounded-sm text-muted-foreground opacity-0 group-hover/filter-option:pointer-events-auto group-hover/filter-option:opacity-100 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100"
                aria-label={labels.filterOnlyType(label)}
                title={labels.filterOnlyType(label)}
                onClick={() => updateOption(keys, true, true)}
              >
                <CrosshairIcon aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          );
        })}
        <CreationLibraryAuthorSelect
          value={filter.author}
          options={authors}
          onChange={(author) => onFilterChange({ ...filter, author })}
        />
      </PopoverContent>
    </Popover>
  );
}
