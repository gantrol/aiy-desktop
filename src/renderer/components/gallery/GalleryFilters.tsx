import type { GallerySourceFilter, ImageRatingDimension } from '@/shared/contracts';
import { GalleryRatingSettings } from '@/renderer/components/gallery/GalleryRatingSettings';
import { GallerySourceTabs } from '@/renderer/components/gallery/GallerySourceTabs';

interface Props {
  source: GallerySourceFilter;
  visibleDimensions: ImageRatingDimension[];
  unratedDimensions: ImageRatingDimension[];
  onSourceChange(source: GallerySourceFilter): void;
  onVisibleDimensionsChange(value: ImageRatingDimension[]): void;
  onUnratedDimensionsChange(value: ImageRatingDimension[]): void;
}

export function GalleryFilters({
  source,
  visibleDimensions,
  unratedDimensions,
  onSourceChange,
  onVisibleDimensionsChange,
  onUnratedDimensionsChange,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <GallerySourceTabs value={source} onChange={onSourceChange} />
      <GalleryRatingSettings
        visibleDimensions={visibleDimensions}
        unratedDimensions={unratedDimensions}
        onVisibleDimensionsChange={onVisibleDimensionsChange}
        onUnratedDimensionsChange={onUnratedDimensionsChange}
      />
    </div>
  );
}
