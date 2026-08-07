import type { GallerySourceFilter } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';

interface Props {
  value: GallerySourceFilter;
  onChange(value: GallerySourceFilter): void;
}

const sources = ['ALL', 'FAVORITE', 'CREATION', 'DICTIONARY'] as const;

export function GallerySourceTabs({ value, onChange }: Props) {
  const { messages } = useI18n();
  const labels = messages.gallery.source;
  return (
    <Segmented
      type="single"
      value={value}
      aria-label={labels.label}
      onValueChange={(next) => next && onChange(next as GallerySourceFilter)}
    >
      {sources.map((source) => (
        <SegmentedItem key={source} data-gallery-filter={source} value={source}>
          {labels[source]}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}
