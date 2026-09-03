import type { Locale } from '@/shared/contracts';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';

export type CreationOutputMode = 'results' | 'inputs' | 'records';

interface Props {
  value: CreationOutputMode;
  locale: Locale;
  onValueChange(value: CreationOutputMode): void;
}

export function CreationOutputTabs({ value, locale, onValueChange }: Props) {
  return (
    <Segmented
      type="single"
      value={value}
      className="shrink-0"
      onValueChange={(next) => next && onValueChange(next as CreationOutputMode)}
      aria-label={locale === 'zh' ? '创作视图' : 'Creation view'}
    >
      <SegmentedItem value="results" className="whitespace-nowrap px-2 @min-[480px]/output:px-3">
        {locale === 'zh' ? '成果' : 'Results'}
      </SegmentedItem>
      <SegmentedItem value="inputs" className="whitespace-nowrap px-2 @min-[480px]/output:px-3">
        {locale === 'zh' ? '输入' : 'Inputs'}
      </SegmentedItem>
      <SegmentedItem value="records" className="whitespace-nowrap px-2 @min-[480px]/output:px-3">
        {locale === 'zh' ? '记录' : 'Records'}
      </SegmentedItem>
    </Segmented>
  );
}
