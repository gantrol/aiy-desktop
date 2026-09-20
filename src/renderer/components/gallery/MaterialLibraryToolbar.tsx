import {
  CheckSquare2Icon,
  Grid2X2Icon,
  HeartIcon,
  Layers3Icon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from 'lucide-react';
import type { CreationRelationFilter, ImageRatingDimension } from '@/shared/contracts';
import { MaterialLayoutControl } from '@/renderer/components/gallery/MaterialLayoutControl';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Separator } from '@/renderer/components/ui/separator';
import type {
  GalleryContentType,
  GalleryRelationship,
  GalleryScope,
  GalleryViewMode,
} from '@/renderer/components/gallery/galleryPreferences';

interface Props {
  query: string;
  scope: GalleryScope;
  relationship: GalleryRelationship;
  contentTypes: GalleryContentType[];
  unratedDimensions: ImageRatingDimension[];
  viewMode?: GalleryViewMode;
  imageNamesAvailable?: boolean;
  selectionMode: boolean;
  selectionAvailable?: boolean;
  availableContentTypes?: GalleryContentType[];
  relationshipLocked?: boolean;
  sourceFilter?: MaterialSourceFilter;
  creationRelationFilter?: CreationRelationFilter;
  onQueryChange(value: string): void;
  onScopeChange(value: GalleryScope): void;
  onRelationshipChange(value: GalleryRelationship): void;
  onContentTypesChange(value: GalleryContentType[]): void;
  onUnratedDimensionsChange(value: ImageRatingDimension[]): void;
  onViewModeChange?(value: GalleryViewMode): void;
  onSelectionModeChange(value: boolean): void;
  onSourceFilterChange?(value: MaterialSourceFilter): void;
  onCreationRelationFilterChange?(value: CreationRelationFilter): void;
}

export type MaterialSourceFilter = 'ALL' | 'CREATION' | 'IMPORT';

const allContentTypeOptions: GalleryContentType[] = ['IMAGE', 'TEXT'];
const ratingOptions: ImageRatingDimension[] = ['AESTHETIC', 'REALISM'];

function toggleValue<T extends string>(current: T[], value: T, checked: boolean, order: T[]) {
  return checked
    ? order.filter((candidate) => candidate === value || current.includes(candidate))
    : current.filter((candidate) => candidate !== value);
}

function MaterialViewToggle({
  value,
  label,
  gridLabel,
  stackLabel,
  onChange,
}: {
  value: GalleryViewMode;
  label: string;
  gridLabel: string;
  stackLabel: string;
  onChange(value: GalleryViewMode): void;
}) {
  return (
    <Segmented
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as GalleryViewMode)}
      aria-label={label}
    >
      <SegmentedItem
        value="GRID"
        data-action="material-grid-view"
        className="w-8 px-0"
        aria-label={gridLabel}
        title={gridLabel}
      >
        <Grid2X2Icon className="size-3.5" />
      </SegmentedItem>
      <SegmentedItem
        value="LIST"
        data-action="material-list-view"
        data-layout-action="material-stack-view"
        className="w-8 px-0"
        aria-label={stackLabel}
        title={stackLabel}
      >
        <Layers3Icon className="size-3.5" />
      </SegmentedItem>
    </Segmented>
  );
}

function CreationRelationFilterControl({
  value,
  onChange,
}: {
  value?: CreationRelationFilter;
  onChange?(value: CreationRelationFilter): void;
}) {
  const { messages } = useI18n();
  const l = messages.gallery.library;
  if (!value || !onChange) return null;
  return (
    <Segmented
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as CreationRelationFilter)}
      aria-label={l.creationImageRelationship}
    >
      <SegmentedItem value="ALL" data-action="material-creation-relation-all">
        {l.allRelated}
      </SegmentedItem>
      <SegmentedItem value="INPUT" data-action="material-creation-relation-input">
        {l.creationInputs}
      </SegmentedItem>
      <SegmentedItem value="OUTPUT" data-action="material-creation-relation-output">
        {l.creationOutputs}
      </SegmentedItem>
    </Segmented>
  );
}

function MaterialSourceFilterControl({
  value,
  onChange,
}: {
  value?: MaterialSourceFilter;
  onChange?(value: MaterialSourceFilter): void;
}) {
  const { messages } = useI18n();
  const l = messages.gallery.library;
  if (!value || !onChange) return null;
  return (
    <Segmented
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as MaterialSourceFilter)}
      aria-label={l.creationRelationship}
    >
      <SegmentedItem value="ALL" data-action="material-source-all">
        {l.scopeAll}
      </SegmentedItem>
      <SegmentedItem value="CREATION" data-action="material-source-creation">
        {l.creationSource}
      </SegmentedItem>
      <SegmentedItem value="IMPORT" data-action="material-source-import">
        {l.otherMaterials}
      </SegmentedItem>
    </Segmented>
  );
}

function FavoriteScopeButton({ active, label, onToggle }: { active: boolean; label: string; onToggle(): void }) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'outline'}
      size="sm"
      className="h-9"
      data-action="material-scope-favorite"
      aria-pressed={active}
      onClick={onToggle}
    >
      <HeartIcon className="size-4" />
      {label}
    </Button>
  );
}

export function MaterialLibraryToolbar({
  query,
  scope,
  relationship,
  contentTypes,
  unratedDimensions,
  viewMode,
  imageNamesAvailable = true,
  selectionMode,
  selectionAvailable = true,
  availableContentTypes = allContentTypeOptions,
  relationshipLocked = false,
  sourceFilter,
  creationRelationFilter,
  onQueryChange,
  onScopeChange,
  onRelationshipChange,
  onContentTypesChange,
  onUnratedDimensionsChange,
  onViewModeChange,
  onSelectionModeChange,
  onSourceFilterChange,
  onCreationRelationFilterChange,
}: Props) {
  const { messages } = useI18n();
  const l = messages.gallery.library;
  const contentTypeOptions = availableContentTypes;
  const activeFilterCount =
    Number(!relationshipLocked && relationship !== 'ANY') +
    Number(contentTypes.length !== contentTypeOptions.length) +
    unratedDimensions.length;

  function clearFilters() {
    if (!relationshipLocked) onRelationshipChange('ANY');
    if (contentTypes.length !== contentTypeOptions.length) onContentTypesChange(contentTypeOptions);
    onUnratedDimensionsChange([]);
  }

  return (
    <div className="shrink-0 border-b bg-background px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <CreationRelationFilterControl value={creationRelationFilter} onChange={onCreationRelationFilterChange} />

        <MaterialSourceFilterControl value={sourceFilter} onChange={onSourceFilterChange} />

        <FavoriteScopeButton
          active={scope === 'FAVORITE'}
          label={l.scopeFavorite}
          onToggle={() => onScopeChange(scope === 'FAVORITE' ? 'ALL' : 'FAVORITE')}
        />

        <div className="relative min-w-[220px] flex-1 sm:max-w-xl">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            data-action="material-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={l.searchPlaceholder}
            aria-label={l.searchLabel}
            className="h-9 pl-9 pr-9"
          />
          {query && (
            <Button
              type="button"
              data-action="material-clear-search"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
              aria-label={l.clearSearch}
              onClick={() => onQueryChange('')}
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={activeFilterCount ? 'secondary' : 'outline'}
              size="sm"
              className="h-9"
              aria-label={l.filterLabel}
            >
              <SlidersHorizontalIcon className="size-4" />
              {l.filter}
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[min(32rem,calc(100vh-6rem))] w-80 space-y-4 overflow-y-auto p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm">{l.filterTitle}</strong>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!activeFilterCount}
                onClick={clearFilters}
              >
                {l.clearAll}
              </Button>
            </div>

            {!relationshipLocked && (
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold">{l.relationshipTitle}</legend>
                <Segmented
                  type="single"
                  value={relationship}
                  className="grid h-auto grid-cols-3"
                  onValueChange={(value) => value && onRelationshipChange(value as GalleryRelationship)}
                >
                  <SegmentedItem value="ANY" className="px-2">
                    {l.relationshipAny}
                  </SegmentedItem>
                  <SegmentedItem value="CREATION" className="px-2">
                    {l.relationshipCreation}
                  </SegmentedItem>
                  <SegmentedItem value="DICTIONARY" className="px-2">
                    {l.relationshipDictionary}
                  </SegmentedItem>
                </Segmented>
                <p className="text-[11px] leading-4 text-muted-foreground">{l.relationshipHint}</p>
              </fieldset>
            )}

            {contentTypeOptions.length > 1 && (
              <>
                {!relationshipLocked && <Separator />}
                <fieldset className="space-y-3">
                  <legend className="text-xs font-semibold">{l.contentTypeTitle}</legend>
                  {contentTypeOptions.map((option) => {
                    const id = `gallery-content-${option.toLowerCase()}`;
                    const checked = contentTypes.includes(option);
                    return (
                      <div key={option} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={checked && contentTypes.length === 1}
                          onCheckedChange={(value) =>
                            onContentTypesChange(toggleValue(contentTypes, option, value === true, contentTypeOptions))
                          }
                        />
                        <Label htmlFor={id} className="font-normal">
                          {l[option]}
                        </Label>
                      </div>
                    );
                  })}
                </fieldset>
              </>
            )}

            <Separator />
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold">{l.unratedTitle}</legend>
              {ratingOptions.map((option) => {
                const id = `gallery-unrated-${option.toLowerCase()}`;
                return (
                  <div key={option} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={unratedDimensions.includes(option)}
                      onCheckedChange={(value) =>
                        onUnratedDimensionsChange(toggleValue(unratedDimensions, option, value === true, ratingOptions))
                      }
                    />
                    <Label htmlFor={id} className="font-normal">
                      {l[option]}
                    </Label>
                  </div>
                );
              })}
              <p className="text-[11px] leading-4 text-muted-foreground">{l.unratedHint}</p>
            </fieldset>
          </PopoverContent>
        </Popover>

        {viewMode !== 'LIST' && <MaterialLayoutControl showNamesControl={imageNamesAvailable} />}

        {viewMode && onViewModeChange && (
          <MaterialViewToggle
            value={viewMode}
            label={l.viewLabel}
            gridLabel={l.gridView}
            stackLabel={l.stackView}
            onChange={onViewModeChange}
          />
        )}

        {selectionAvailable && (
          <Button
            type="button"
            data-action="material-selection-mode"
            variant={selectionMode ? 'secondary' : 'outline'}
            size="sm"
            className="h-9"
            aria-pressed={selectionMode}
            onClick={() => onSelectionModeChange(!selectionMode)}
          >
            <CheckSquare2Icon className="size-4" />
            {selectionMode ? l.doneSelecting : l.select}
          </Button>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={l.appliedFilters}>
          {!relationshipLocked && relationship !== 'ANY' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 rounded-full px-2 text-[11px]"
              onClick={() => onRelationshipChange('ANY')}
            >
              {relationship === 'CREATION' ? l.relationshipCreation : l.relationshipDictionary}
              <XIcon className="size-3" />
            </Button>
          )}
          {contentTypeOptions.length > 1 && contentTypes.length === 1 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 rounded-full px-2 text-[11px]"
              onClick={() => onContentTypesChange(contentTypeOptions)}
            >
              {l[contentTypes[0]]}
              <XIcon className="size-3" />
            </Button>
          )}
          {unratedDimensions.map((dimension) => (
            <Button
              key={dimension}
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 rounded-full px-2 text-[11px]"
              onClick={() => onUnratedDimensionsChange(unratedDimensions.filter((value) => value !== dimension))}
            >
              {l.unratedChip(l[dimension])}
              <XIcon className="size-3" />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
