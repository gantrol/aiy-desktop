import { HistoryIcon, ImagesIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';

export type CreationOutputMode = 'results' | 'inputs' | 'records';

interface Props {
  value: CreationOutputMode;
  onValueChange(value: CreationOutputMode): void;
}

export function CreationOutputTabs({ value, onValueChange }: Props) {
  const labels = useI18n().messages.creator.outputTabs;
  return (
    <Segmented
      type="single"
      value={value}
      className="h-9 shrink-0"
      onValueChange={(next) => next && onValueChange(next as CreationOutputMode)}
      aria-label={labels.title}
    >
      <SegmentedItem value="results" className="size-8 shrink-0 p-0" title={labels.results} aria-label={labels.results}>
        <ImagesIcon className="size-4" aria-hidden="true" />
      </SegmentedItem>
      <SegmentedItem value="inputs" className="size-8 shrink-0 p-0" title={labels.inputs} aria-label={labels.inputs}>
        <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
      </SegmentedItem>
      <SegmentedItem value="records" className="size-8 shrink-0 p-0" title={labels.records} aria-label={labels.records}>
        <HistoryIcon className="size-4" aria-hidden="true" />
      </SegmentedItem>
    </Segmented>
  );
}
