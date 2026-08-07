import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import type { AlbumNavigationLabels, AlbumNavigationSurface } from '@/renderer/components/gallery/AlbumNavigation';

interface Props {
  value: AlbumNavigationSurface;
  labels: AlbumNavigationLabels;
  onChange(surface: AlbumNavigationSurface): void;
}

export function AlbumNavigationSurfaceTabs({ value, labels, onChange }: Props) {
  return (
    <div className="border-b p-2">
      <Segmented
        type="single"
        value={value}
        className="grid h-auto grid-cols-2"
        aria-label={`${labels.material ?? labels.allMaterials} / ${labels.dictionary ?? 'Dictionary'}`}
        onValueChange={(next) => next && onChange(next as AlbumNavigationSurface)}
      >
        <SegmentedItem data-action="material-tab-library" value="MATERIAL" className="min-w-0 px-2">
          {labels.material ?? labels.allMaterials}
        </SegmentedItem>
        <SegmentedItem data-action="material-tab-dictionary" value="DICTIONARY" className="min-w-0 px-2">
          {labels.dictionary ?? 'Dictionary'}
        </SegmentedItem>
      </Segmented>
    </div>
  );
}
