import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentSearchKindSchema, type ContentLookupInput } from '@/shared/contracts/content-search';

export function ContentSearchFilters({
  value,
  onChange,
}: {
  value: ContentLookupInput['type'];
  onChange(value: ContentLookupInput['type']): void;
}) {
  const copy = useI18n().messages.referenceOutline.lookup;
  return (
    <Segmented
      type="single"
      value={value}
      onValueChange={(next) => {
        const parsed = contentSearchKindSchema.safeParse(next);
        if (parsed.success) onChange(parsed.data);
      }}
      aria-label={copy.contentType}
      className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0"
    >
      {contentSearchKindSchema.options.map((type) => (
        <SegmentedItem
          key={type}
          value={type}
          className="h-7 px-2.5 data-[state=on]:border-transparent data-[state=on]:bg-selected data-[state=on]:text-selected-foreground data-[state=on]:hover:bg-selected data-[state=on]:active:bg-selected"
        >
          {type === 'ALL' ? copy.all : copy[type]}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}
