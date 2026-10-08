import { CrosshairIcon, SlidersHorizontalIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ItemActions, itemActionButtonClassName } from '@/renderer/components/ui/item-actions';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CreationLibraryAuthorSelect } from '@/renderer/components/creator/CreationLibraryAuthorSelect';
import type { CreationLibraryAuthorOption } from '@/renderer/components/creator/creationLibraryAuthorFilter';
import {
  useCreationLibraryFilterLabels,
  type CreationLibraryFilterOption,
} from '@/renderer/components/creator/useCreationLibraryFilterLabels';
import {
  allCreationLibraryFilters,
  emptyCreationLibraryFilters,
  type CreationLibraryFilter,
} from '@/renderer/components/creator/creationLibraryFilter';

interface Props {
  filter: CreationLibraryFilter;
  onFilterChange(filter: CreationLibraryFilter): void;
  authors?: readonly CreationLibraryAuthorOption[];
}

export function CreationLibraryFilterMenu({ filter, onFilterChange, authors = [] }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const { options, allSelected, noneSelected, controlLabel, active } = useCreationLibraryFilterLabels(filter, authors);

  function updateOption(keys: CreationLibraryFilterOption['keys'], checked: boolean, only = false) {
    const next = { ...filter, ...(only ? emptyCreationLibraryFilters : {}) };
    for (const key of keys) next[key] = checked;
    onFilterChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-sm"
          className="relative h-8 shrink-0"
          title={controlLabel}
          aria-label={controlLabel}
        >
          <SlidersHorizontalIcon className="size-4 shrink-0" aria-hidden />
          {active && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-current" aria-hidden />}
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
            <div key={keys[0]} className="group/item flex items-center rounded-sm hover:bg-hover focus-within:bg-hover">
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
              <ItemActions>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={itemActionButtonClassName}
                  aria-label={labels.filterOnlyType(label)}
                  title={labels.filterOnlyType(label)}
                  onClick={() => updateOption(keys, true, true)}
                >
                  <CrosshairIcon aria-hidden="true" className="size-3.5" />
                </Button>
              </ItemActions>
            </div>
          );
        })}
        <CreationLibraryAuthorSelect
          value={filter.author}
          options={authors}
          onChange={(author) => onFilterChange({ ...filter, author })}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start border-t text-xs"
          disabled={!active}
          onClick={() => onFilterChange({ ...allCreationLibraryFilters })}
        >
          {labels.filterReset}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
