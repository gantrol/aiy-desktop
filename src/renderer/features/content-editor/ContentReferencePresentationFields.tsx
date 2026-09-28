import { Checkbox } from '@/renderer/components/ui/checkbox';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ReferencePresentation } from '@/shared/content-reference-token';

export function ContentReferencePresentationFields({
  value,
  onChange,
  disabled,
}: {
  value: ReferencePresentation;
  disabled: boolean;
  onChange(value: ReferencePresentation): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs">
      <label className="flex items-center gap-2">
        <Checkbox
          disabled={disabled}
          checked={value.display === 'BODY'}
          onCheckedChange={(checked) => onChange({ ...value, display: checked === true ? 'BODY' : 'QUOTE' })}
        />
        {copy.inlineBody}
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          disabled={disabled}
          checked={value.showTitle}
          onCheckedChange={(checked) => onChange({ ...value, showTitle: checked === true })}
        />
        {copy.showSourceTitle}
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          disabled={disabled}
          checked={value.headings === 'NEST'}
          onCheckedChange={(checked) => onChange({ ...value, headings: checked === true ? 'NEST' : 'PRESERVE' })}
        />
        {copy.nestHeadings}
      </label>
    </div>
  );
}
