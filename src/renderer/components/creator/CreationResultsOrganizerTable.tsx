import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import type { PromptVersionDto } from '@/shared/contracts';
import { useProvenanceSuggestions } from '@/renderer/components/provenance/useProvenanceSuggestions';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ComboboxInput } from '@/renderer/components/ui/combobox-input';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { CreationResultPreviewHoverCard } from '@/renderer/components/creator/CreationResultPreviewHoverCard';
import { CreationResultsOrganizerBulkRow } from '@/renderer/components/creator/CreationResultsOrganizerBulkRow';
import {
  createOrganizerVersionValue,
  organizerRelationValue,
  parseOrganizerRelationValue,
  type CreationResultDraftRow,
  type OrganizerAiGeneratedStatus,
  type OrganizerVersionOption,
  unlinkedOrganizerVersionValue,
} from '@/renderer/components/creator/creationResultsOrganizer';
import { useI18n } from '@/renderer/i18n/useI18n';
import { usePromptVersionLabel } from '@/renderer/components/creator/usePromptVersionLabel';

type RowUpdate = Partial<Omit<CreationResultDraftRow, 'output'>>;

interface VersionSelectProps {
  row: CreationResultDraftRow;
  versions: readonly OrganizerVersionOption[];
  nextVersionLabel: string;
  disabled: boolean;
  onUpdate(update: RowUpdate): void;
  onCreateVersion(): void;
}

function OutputVersionSelect({
  row,
  versions,
  nextVersionLabel,
  disabled,
  onUpdate,
  onCreateVersion,
}: VersionSelectProps) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  const versionLabel = usePromptVersionLabel();
  return (
    <Select
      value={row.promptVersionId ?? unlinkedOrganizerVersionValue}
      disabled={disabled}
      onValueChange={(value) => {
        if (value === createOrganizerVersionValue) {
          onCreateVersion();
          return;
        }
        onUpdate({ promptVersionId: value === unlinkedOrganizerVersionValue ? null : value });
      }}
    >
      <SelectTrigger className="h-8 w-full min-w-36 text-xs" aria-label={labels.version}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={unlinkedOrganizerVersionValue}>{labels.unlinkedVersion}</SelectItem>
        {versions.map((version) => (
          <SelectItem key={version.id} value={version.id}>
            {versionLabel(version)}
          </SelectItem>
        ))}
        <SelectItem value={createOrganizerVersionValue}>+ {labels.createVersion(nextVersionLabel)}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function OutputRelationshipSelect({
  row,
  rows,
  disabled,
  onUpdate,
}: {
  row: CreationResultDraftRow;
  rows: readonly CreationResultDraftRow[];
  disabled: boolean;
  onUpdate(update: RowUpdate): void;
}) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  return (
    <Select
      value={organizerRelationValue(row)}
      disabled={disabled}
      onValueChange={(value) => onUpdate(parseOrganizerRelationValue(value))}
    >
      <SelectTrigger className="h-8 w-full min-w-60 text-xs" aria-label={labels.relationship}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="UNSPECIFIED">{labels.relationshipUnspecified}</SelectItem>
        <SelectItem value="PRIMARY">{labels.relationshipPrimary}</SelectItem>
        {rows
          .filter((candidate) => candidate.output.id !== row.output.id)
          .flatMap((candidate) => [
            <SelectItem key={`VARIANT:${candidate.output.id}`} value={`VARIANT:${candidate.output.id}`}>
              {labels.relationshipVariant(candidate.displayName)}
            </SelectItem>,
            <SelectItem key={`DERIVED:${candidate.output.id}`} value={`DERIVED:${candidate.output.id}`}>
              {labels.relationshipDerived(candidate.displayName)}
            </SelectItem>,
            <SelectItem key={`POST_EDIT:${candidate.output.id}`} value={`POST_EDIT:${candidate.output.id}`}>
              {labels.relationshipPostEdit(candidate.displayName)}
            </SelectItem>,
          ])}
      </SelectContent>
    </Select>
  );
}

function OutputAiSelect({
  row,
  disabled,
  onUpdate,
}: {
  row: CreationResultDraftRow;
  disabled: boolean;
  onUpdate(update: RowUpdate): void;
}) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  return (
    <Select
      value={row.aiGeneratedStatus}
      disabled={disabled}
      onValueChange={(value) =>
        onUpdate({
          aiGeneratedStatus: value as OrganizerAiGeneratedStatus,
          ...(value === 'NO' ? { modelName: '', modelProvider: '' } : {}),
        })
      }
    >
      <SelectTrigger className="h-8 w-full min-w-28 text-xs" aria-label={labels.aiGenerated}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="YES">{labels.aiYes}</SelectItem>
        <SelectItem value="NO">{labels.aiNo}</SelectItem>
        <SelectItem value="UNKNOWN">{labels.aiUnknown}</SelectItem>
        <SelectItem value="OTHER">{labels.aiOther}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function OrderButtons({
  index,
  count,
  disabled,
  onMove,
}: {
  index: number;
  count: number;
  disabled: boolean;
  onMove(direction: -1 | 1): void;
}) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  return (
    <div className="flex items-center justify-center gap-1">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        title={labels.moveUp}
        aria-label={labels.moveUp}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        title={labels.moveDown}
        aria-label={labels.moveDown}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon className="size-3.5" />
      </Button>
    </div>
  );
}

interface Props {
  rows: readonly CreationResultDraftRow[];
  versions: readonly OrganizerVersionOption[];
  promptVersions: readonly PromptVersionDto[];
  nextVersionLabel: string;
  selectedIds: ReadonlySet<string>;
  busy: boolean;
  onToggleAll(checked: boolean): void;
  onToggleRow(outputId: string, checked: boolean): void;
  onUpdateAll(update: RowUpdate): void;
  onUpdateRow(outputId: string, update: RowUpdate): void;
  onMoveRow(outputId: string, direction: -1 | 1): void;
  onCreateVersion(outputId: string): void;
}

export function CreationResultsOrganizerTable({
  rows,
  versions,
  promptVersions,
  nextVersionLabel,
  selectedIds,
  busy,
  onToggleAll,
  onToggleRow,
  onUpdateAll,
  onUpdateRow,
  onMoveRow,
  onCreateVersion,
}: Props) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  const provenanceSuggestions = useProvenanceSuggestions(true);
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.output.id));
  const someSelected = rows.some((row) => selectedIds.has(row.output.id));
  return (
    <div className="max-h-[calc(100vh-14rem)] min-h-56 overflow-auto">
      <Table className="min-w-[92rem]">
        <TableHeader className="sticky top-0 z-10 bg-overlay">
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label={labels.selectAll}
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                disabled={busy || !rows.length}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
              />
            </TableHead>
            <TableHead className="w-16">{labels.preview}</TableHead>
            <TableHead className="min-w-52">{labels.name}</TableHead>
            <TableHead className="min-w-40">{labels.version}</TableHead>
            <TableHead className="min-w-64">{labels.relationship}</TableHead>
            <TableHead className="min-w-32">{labels.aiGenerated}</TableHead>
            <TableHead className="min-w-52">{labels.model}</TableHead>
            <TableHead className="min-w-52">{labels.platform}</TableHead>
            <TableHead className="w-24 text-center">{labels.order}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <CreationResultsOrganizerBulkRow
            rows={rows}
            busy={busy}
            modelsForSource={provenanceSuggestions.modelsForSource}
            sourcesForModel={provenanceSuggestions.sourcesForModel}
            onUpdate={onUpdateAll}
          />
          {rows.map((row, index) => (
            <TableRow key={row.output.id} data-state={selectedIds.has(row.output.id) ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  aria-label={labels.selectOutput(row.displayName)}
                  checked={selectedIds.has(row.output.id)}
                  disabled={busy}
                  onCheckedChange={(checked) => onToggleRow(row.output.id, checked === true)}
                />
              </TableCell>
              <TableCell>
                <CreationResultPreviewHoverCard row={row} belowRow={rows[index + 1]} versions={promptVersions} />
              </TableCell>
              <TableCell>
                <Input
                  className="h-8 text-xs"
                  value={row.displayName}
                  maxLength={500}
                  disabled={busy}
                  onChange={(event) => onUpdateRow(row.output.id, { displayName: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <OutputVersionSelect
                  row={row}
                  versions={versions}
                  nextVersionLabel={nextVersionLabel}
                  disabled={busy}
                  onUpdate={(update) => onUpdateRow(row.output.id, update)}
                  onCreateVersion={() => onCreateVersion(row.output.id)}
                />
              </TableCell>
              <TableCell>
                <OutputRelationshipSelect
                  row={row}
                  rows={rows}
                  disabled={busy}
                  onUpdate={(update) => onUpdateRow(row.output.id, update)}
                />
              </TableCell>
              <TableCell>
                <OutputAiSelect row={row} disabled={busy} onUpdate={(update) => onUpdateRow(row.output.id, update)} />
              </TableCell>
              <TableCell>
                <ComboboxInput
                  className="min-w-48"
                  value={row.modelName}
                  suggestions={provenanceSuggestions.modelsForSource(row.modelProvider)}
                  openLabel={labels.modelOptions}
                  placeholder={labels.modelPlaceholder}
                  maxLength={300}
                  disabled={busy || row.aiGeneratedStatus === 'NO'}
                  onValueChange={(modelName) =>
                    onUpdateRow(row.output.id, {
                      modelName,
                      ...(modelName.trim() && row.aiGeneratedStatus === 'UNKNOWN' ? { aiGeneratedStatus: 'YES' } : {}),
                    })
                  }
                />
              </TableCell>
              <TableCell>
                <ComboboxInput
                  className="min-w-48"
                  value={row.modelProvider}
                  suggestions={provenanceSuggestions.sourcesForModel(row.modelName)}
                  openLabel={labels.platformOptions}
                  placeholder={labels.platformPlaceholder}
                  maxLength={200}
                  disabled={busy || row.aiGeneratedStatus === 'NO'}
                  onValueChange={(modelProvider) => onUpdateRow(row.output.id, { modelProvider })}
                />
              </TableCell>
              <TableCell>
                <OrderButtons
                  index={index}
                  count={rows.length}
                  disabled={busy}
                  onMove={(direction) => onMoveRow(row.output.id, direction)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
