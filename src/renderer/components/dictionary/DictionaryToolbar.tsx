import type { FacetDefinitionDto } from '@/shared/contracts';
import { ClipboardCheckIcon, ListTreeIcon, LoaderCircleIcon } from 'lucide-react';
import type { DictionaryMessages } from '@/renderer/i18n/catalog';
import { FilterIcon, PlusIcon, SearchIcon, UploadIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Separator } from '@/renderer/components/ui/separator';
import { FacetGroups } from '@/renderer/components/dictionary/FacetGroups';

interface Props {
  copy: DictionaryMessages;
  termCount: number;
  query: string;
  filterOpen: boolean;
  filterCount: number;
  facets: FacetDefinitionDto[];
  selectedFacets: string[];
  selectedTermCount: number;
  excludeDrafts: boolean;
  excludeUncited: boolean;
  includeArchived: boolean;
  maintenanceLabel: string;
  classificationsLabel: string;
  importPreparing: boolean;
  onQueryChange(query: string): void;
  onFilterOpenChange(open: boolean): void;
  onFacetToggle(valueId: string): void;
  onExcludeDraftsChange(value: boolean): void;
  onExcludeUncitedChange(value: boolean): void;
  onIncludeArchivedChange(value: boolean): void;
  onClearFilters(): void;
  onClearTermFilter(): void;
  onNewTerm(): void;
  onImport(): void;
  onMaintenance(): void;
  onClassifications(): void;
}

export function DictionaryToolbar(props: Props) {
  const { copy: c } = props;
  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between px-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{c.title}</h1>
          <span className="text-xs text-muted-foreground">
            {props.termCount} {c.rows}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-action="dictionary-classifications"
            variant="outline"
            size="icon"
            aria-label={props.classificationsLabel}
            title={props.classificationsLabel}
            onClick={props.onClassifications}
          >
            <ListTreeIcon className="size-4" />
          </Button>
          <Button
            data-action="dictionary-maintenance"
            variant="outline"
            size="icon"
            aria-label={props.maintenanceLabel}
            title={props.maintenanceLabel}
            onClick={props.onMaintenance}
          >
            <ClipboardCheckIcon className="size-4" />
          </Button>
          <Button
            data-action="dictionary-new"
            variant="outline"
            size="icon"
            aria-label={c.newTerm}
            title={c.newTerm}
            onClick={props.onNewTerm}
          >
            <PlusIcon className="size-4" />
          </Button>
          <Button
            data-action="dictionary-import"
            variant="outline"
            size="icon"
            aria-label={c.import}
            title={c.import}
            aria-busy={props.importPreparing}
            disabled={props.importPreparing}
            onClick={props.onImport}
          >
            {props.importPreparing ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <UploadIcon className="size-4" />
            )}
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 gap-2 px-3 pb-3">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-action="dictionary-search"
            className="bg-background pl-9"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder={c.search}
          />
        </div>
        <Popover open={props.filterOpen} onOpenChange={props.onFilterOpenChange}>
          <PopoverTrigger asChild>
            <Button
              data-action="dictionary-filter"
              variant="outline"
              size="icon"
              className={cn(
                'relative',
                props.filterCount > 0 &&
                  'border-selected-border bg-selected text-selected-foreground hover:bg-selected',
              )}
              aria-label={c.filter}
              title={c.filter}
            >
              <FilterIcon className="size-4" />
              {props.filterCount > 0 && (
                <Badge className="absolute -top-2 -right-2 min-w-5 px-1 text-[10px]">{props.filterCount}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
            <div className="flex h-12 items-center justify-between px-4">
              <strong className="text-sm">
                {c.filter}
                {props.filterCount ? ` · ${props.filterCount}` : ''}
              </strong>
              <Button variant="ghost" size="sm" onClick={props.onClearFilters}>
                {c.clear}
              </Button>
            </div>
            <Separator />
            <ScrollArea type="always" className="h-[480px] max-h-[calc(100vh-190px)]">
              <div className="p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">{c.record}</p>
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={props.excludeDrafts}
                      onCheckedChange={(checked) => props.onExcludeDraftsChange(checked === true)}
                    />
                    {c.hideDrafts}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={props.excludeUncited}
                      onCheckedChange={(checked) => props.onExcludeUncitedChange(checked === true)}
                    />
                    {c.hideUncited}
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={props.includeArchived}
                      onCheckedChange={(checked) => props.onIncludeArchivedChange(checked === true)}
                    />
                    {c.showArchived}
                  </label>
                </div>
                <FacetGroups
                  facets={props.facets}
                  selectedIds={props.selectedFacets}
                  mode="filter"
                  onToggle={props.onFacetToggle}
                />
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>
      {props.selectedTermCount > 0 && (
        <div className="flex shrink-0 px-3 pb-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 rounded-full"
            onClick={props.onClearTermFilter}
          >
            {c.wordFilter} {props.selectedTermCount}
            <span aria-hidden>×</span>
          </Button>
        </div>
      )}
    </>
  );
}
