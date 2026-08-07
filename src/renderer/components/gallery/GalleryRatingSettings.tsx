import { SlidersHorizontalIcon } from 'lucide-react';
import type { ImageRatingDimension } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';

interface Props {
  visibleDimensions: ImageRatingDimension[];
  unratedDimensions: ImageRatingDimension[];
  onVisibleDimensionsChange(value: ImageRatingDimension[]): void;
  onUnratedDimensionsChange(value: ImageRatingDimension[]): void;
}

const dimensions: ImageRatingDimension[] = ['AESTHETIC', 'REALISM'];

function toggleDimension(current: ImageRatingDimension[], dimension: ImageRatingDimension, checked: boolean) {
  return checked
    ? dimensions.filter((candidate) => candidate === dimension || current.includes(candidate))
    : current.filter((candidate) => candidate !== dimension);
}

export function GalleryRatingSettings({
  visibleDimensions,
  unratedDimensions,
  onVisibleDimensionsChange,
  onUnratedDimensionsChange,
}: Props) {
  const { messages } = useI18n();
  const l = messages.gallery.settings;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          data-gallery-rating-settings
          type="button"
          variant={unratedDimensions.length ? 'secondary' : 'outline'}
          size="sm"
          className="h-9"
          aria-label={l.triggerDescription}
          title={l.triggerDescription}
        >
          <SlidersHorizontalIcon className="size-3.5" />
          {l.trigger}
          {unratedDimensions.length > 0 && (
            <Badge variant="secondary" className="h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">
              {unratedDimensions.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-4 p-4">
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold">{l.visibleTitle}</legend>
          {dimensions.map((dimension) => {
            const checked = visibleDimensions.includes(dimension);
            const id = `gallery-visible-${dimension.toLowerCase()}`;
            return (
              <div key={dimension} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  data-gallery-visible-rating={dimension}
                  checked={checked}
                  onCheckedChange={(value) =>
                    onVisibleDimensionsChange(toggleDimension(visibleDimensions, dimension, value === true))
                  }
                />
                <Label htmlFor={id} className="font-normal">
                  {l[dimension]}
                </Label>
              </div>
            );
          })}
        </fieldset>
        <Separator />
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold">{l.unratedTitle}</legend>
          {dimensions.map((dimension) => {
            const id = `gallery-unrated-${dimension.toLowerCase()}`;
            return (
              <div key={dimension} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  data-gallery-unrated-rating={dimension}
                  checked={unratedDimensions.includes(dimension)}
                  onCheckedChange={(value) =>
                    onUnratedDimensionsChange(toggleDimension(unratedDimensions, dimension, value === true))
                  }
                />
                <Label htmlFor={id} className="font-normal">
                  {l[dimension]}
                </Label>
              </div>
            );
          })}
          <p className="text-[11px] leading-4 text-muted-foreground">{l.unratedHint}</p>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
