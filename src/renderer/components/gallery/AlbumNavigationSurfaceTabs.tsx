import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import type { AlbumNavigationLabels, AlbumNavigationSurface } from '@/renderer/components/gallery/AlbumNavigation';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  value: AlbumNavigationSurface;
  labels: AlbumNavigationLabels;
  onChange(surface: AlbumNavigationSurface): void;
}

export function AlbumNavigationSurfaceTabs({ value, labels, onChange }: Props) {
  const { messages } = useI18n();
  const dictionaryLabel = labels.dictionary ?? messages.app.navigation.dictionary;
  return (
    <div>
      <Segmented
        type="single"
        appearance="line"
        value={value}
        className="grid grid-cols-2 px-2"
        aria-label={`${labels.material ?? labels.allMaterials} / ${dictionaryLabel}`}
        onValueChange={(next) => next && onChange(next as AlbumNavigationSurface)}
      >
        <SegmentedItem data-action="material-tab-library" value="MATERIAL" className="min-w-0 px-2">
          {labels.material ?? labels.allMaterials}
        </SegmentedItem>
        <SegmentedItem data-action="material-tab-dictionary" value="DICTIONARY" className="min-w-0 px-2">
          {dictionaryLabel}
        </SegmentedItem>
      </Segmented>
    </div>
  );
}
