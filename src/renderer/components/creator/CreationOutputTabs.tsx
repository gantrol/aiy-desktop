import type { Locale } from '@/shared/contracts';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';

export type CreationOutputMode = 'images' | 'ideas' | 'writing';

interface Props {
  value: CreationOutputMode;
  locale: Locale;
  ideasDisabled?: boolean;
  writingDisabled?: boolean;
  onValueChange(value: CreationOutputMode): void;
}

export function CreationOutputTabs({
  value,
  locale,
  ideasDisabled = false,
  writingDisabled = false,
  onValueChange,
}: Props) {
  return (
    <Segmented
      type="single"
      value={value}
      className="shrink-0"
      onValueChange={(next) => next && onValueChange(next as CreationOutputMode)}
      aria-label={locale === 'zh' ? '产出类型' : 'Output type'}
    >
      <SegmentedItem value="images" className="whitespace-nowrap px-3">
        {locale === 'zh' ? '图片' : 'Images'}
      </SegmentedItem>
      <SegmentedItem value="ideas" className="whitespace-nowrap px-3" disabled={ideasDisabled}>
        {locale === 'zh' ? '灵感' : 'Ideas'}
      </SegmentedItem>
      <SegmentedItem value="writing" className="whitespace-nowrap px-3" disabled={writingDisabled}>
        {locale === 'zh' ? '帮写' : 'Writing'}
      </SegmentedItem>
    </Segmented>
  );
}
