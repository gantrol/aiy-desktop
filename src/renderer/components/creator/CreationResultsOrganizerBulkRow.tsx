import { ComboboxInput, type ComboboxInputSuggestion } from '@/renderer/components/ui/combobox-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { TableCell, TableRow } from '@/renderer/components/ui/table';
import {
  type CreationResultDraftRow,
  type OrganizerAiGeneratedStatus,
  unchangedOrganizerValue,
} from '@/renderer/components/creator/creationResultsOrganizer';
import { useI18n } from '@/renderer/i18n/useI18n';

type RowUpdate = Partial<Omit<CreationResultDraftRow, 'output'>>;

interface Props {
  rows: readonly CreationResultDraftRow[];
  busy: boolean;
  modelsForSource(source: string): readonly ComboboxInputSuggestion[];
  sourcesForModel(model: string): readonly ComboboxInputSuggestion[];
  onUpdate(update: RowUpdate): void;
}

function sharedValue(rows: readonly CreationResultDraftRow[], select: (row: CreationResultDraftRow) => string) {
  const value = rows[0] ? select(rows[0]) : '';
  return rows.some((row) => select(row) !== value) ? { value: '', mixed: true } : { value, mixed: false };
}

export function CreationResultsOrganizerBulkRow({ rows, busy, modelsForSource, sourcesForModel, onUpdate }: Props) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  const aiStatuses = new Set(rows.map((row) => row.aiGeneratedStatus));
  const aiGeneratedStatus =
    aiStatuses.size === 1 ? (aiStatuses.values().next().value as OrganizerAiGeneratedStatus) : unchangedOrganizerValue;
  const model = sharedValue(rows, (row) => row.modelName);
  const provider = sharedValue(rows, (row) => row.modelProvider);
  const provenanceDisabled = busy || aiGeneratedStatus === 'NO';

  return (
    <TableRow className="bg-surface-sunken/60 hover:bg-surface-sunken/60">
      <TableCell colSpan={5} className="font-medium">
        {labels.changeAll}
      </TableCell>
      <TableCell>
        <Select
          value={aiGeneratedStatus}
          disabled={busy}
          onValueChange={(value) => {
            if (value !== unchangedOrganizerValue) onUpdate({ aiGeneratedStatus: value as OrganizerAiGeneratedStatus });
          }}
        >
          <SelectTrigger className="h-8 w-full min-w-28 text-xs" aria-label={labels.changeAllAiGenerated}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={unchangedOrganizerValue}>{labels.mixedValues}</SelectItem>
            <SelectItem value="YES">{labels.aiYes}</SelectItem>
            <SelectItem value="NO">{labels.aiNo}</SelectItem>
            <SelectItem value="UNKNOWN">{labels.aiUnknown}</SelectItem>
            <SelectItem value="OTHER">{labels.aiOther}</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <ComboboxInput
          className="min-w-48"
          value={model.value}
          suggestions={modelsForSource(provider.value)}
          openLabel={labels.modelOptions}
          placeholder={model.mixed ? labels.mixedValues : labels.modelPlaceholder}
          aria-label={labels.changeAllModel}
          maxLength={300}
          disabled={provenanceDisabled}
          onValueChange={(modelName) =>
            onUpdate({ modelName, ...(modelName.trim() ? { aiGeneratedStatus: 'YES' } : {}) })
          }
        />
      </TableCell>
      <TableCell>
        <ComboboxInput
          className="min-w-48"
          value={provider.value}
          suggestions={sourcesForModel(model.value)}
          openLabel={labels.platformOptions}
          placeholder={provider.mixed ? labels.mixedValues : labels.platformPlaceholder}
          aria-label={labels.changeAllPlatform}
          maxLength={200}
          disabled={provenanceDisabled}
          onValueChange={(modelProvider) => onUpdate({ modelProvider })}
        />
      </TableCell>
      <TableCell aria-hidden="true" />
    </TableRow>
  );
}
