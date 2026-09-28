import { DropdownMenuCheckboxItem } from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ReferencePresentation } from '@/shared/content-reference-token';

export function ContentReferencePresentationMenu({
  presentation,
  onChange,
}: {
  presentation?: ReferencePresentation;
  onChange(value: ReferencePresentation): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  const value = presentation ?? { display: 'QUOTE', showTitle: false, headings: 'PRESERVE' };
  return (
    <>
      <DropdownMenuCheckboxItem
        checked={value.display === 'BODY'}
        onCheckedChange={(body) => onChange({ ...value, display: body ? 'BODY' : 'QUOTE' })}
      >
        {copy.inlineBody}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={value.showTitle}
        onCheckedChange={(showTitle) => onChange({ ...value, showTitle })}
      >
        {copy.showSourceTitle}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={value.headings === 'NEST'}
        onCheckedChange={(nested) => onChange({ ...value, headings: nested ? 'NEST' : 'PRESERVE' })}
      >
        {copy.nestHeadings}
      </DropdownMenuCheckboxItem>
    </>
  );
}
