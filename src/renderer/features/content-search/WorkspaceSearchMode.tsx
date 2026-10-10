import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { workspaceSearchModeSchema, type WorkspaceSearchMode as Mode } from '@/shared/contracts/image-search';

export function WorkspaceSearchMode({
  value,
  onChange,
  allowText = true,
}: {
  value: Mode;
  onChange(value: Mode): void;
  allowText?: boolean;
}) {
  const copy = useI18n().messages.referenceOutline.lookup;
  return (
    <Select value={value} onValueChange={(value) => onChange(workspaceSearchModeSchema.parse(value))}>
      <SelectTrigger className="h-8 w-auto shrink-0 gap-2" aria-label={copy.searchMode}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowText && <SelectItem value="TEXT">{copy.keywordSearch}</SelectItem>}
        <SelectItem value="SEMANTIC">{copy.semanticSearch}</SelectItem>
        <SelectItem value="HYBRID">{copy.hybridSearch}</SelectItem>
      </SelectContent>
    </Select>
  );
}
