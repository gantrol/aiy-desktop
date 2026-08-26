import { ListFilterIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react';
import type { ImportedCreationOutputDto, PromptSeriesDto, PromptVersionCreateResult } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { CreationResultsOrganizerTable } from '@/renderer/components/creator/CreationResultsOrganizerTable';
import {
  createOrganizerVersionValue,
  organizerVersionLabel,
  type OrganizerAiGeneratedStatus,
  type OrganizerVersionOption,
  unchangedOrganizerValue,
  unlinkedOrganizerVersionValue,
} from '@/renderer/components/creator/creationResultsOrganizer';
import { useCreationResultsOrganizer } from '@/renderer/components/creator/useCreationResultsOrganizer';
import { useI18n } from '@/renderer/i18n/useI18n';

interface ToolbarProps {
  selectedCount: number;
  batchVersionValue: string;
  batchAiValue: typeof unchangedOrganizerValue | OrganizerAiGeneratedStatus;
  versions: readonly OrganizerVersionOption[];
  nextVersionLabel: string;
  someSelected: boolean;
  busy: boolean;
  versionCreating: boolean;
  onBatchVersionChange(value: string): void;
  onBatchAiChange(value: typeof unchangedOrganizerValue | OrganizerAiGeneratedStatus): void;
  onApply(): void;
  onInfer(): void;
  onCreateVersion(): void;
}

function OrganizerToolbar({
  selectedCount,
  batchVersionValue,
  batchAiValue,
  versions,
  nextVersionLabel,
  someSelected,
  busy,
  versionCreating,
  onBatchVersionChange,
  onBatchAiChange,
  onApply,
  onInfer,
  onCreateVersion,
}: ToolbarProps) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-2 border-b bg-surface-sunken/60 px-4 py-2.5">
      <span className="mr-1 text-xs text-muted-foreground">{labels.selectedCount(selectedCount)}</span>
      <Select value={batchVersionValue} disabled={busy || !someSelected} onValueChange={onBatchVersionChange}>
        <SelectTrigger className="h-8 w-44 text-xs" aria-label={labels.version}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={unchangedOrganizerValue}>{labels.unchanged}</SelectItem>
          <SelectItem value={unlinkedOrganizerVersionValue}>{labels.unlinkedVersion}</SelectItem>
          {versions.map((version) => (
            <SelectItem key={version.id} value={version.id}>
              {organizerVersionLabel(version)}
            </SelectItem>
          ))}
          <SelectItem value={createOrganizerVersionValue}>+ {labels.createVersion(nextVersionLabel)}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={batchAiValue}
        disabled={busy || !someSelected}
        onValueChange={(value) => onBatchAiChange(value as typeof batchAiValue)}
      >
        <SelectTrigger className="h-8 w-36 text-xs" aria-label={labels.aiGenerated}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={unchangedOrganizerValue}>{labels.unchanged}</SelectItem>
          <SelectItem value="YES">{labels.aiYes}</SelectItem>
          <SelectItem value="NO">{labels.aiNo}</SelectItem>
          <SelectItem value="UNKNOWN">{labels.aiUnknown}</SelectItem>
          <SelectItem value="OTHER">{labels.aiOther}</SelectItem>
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          busy ||
          !someSelected ||
          (batchVersionValue === unchangedOrganizerValue && batchAiValue === unchangedOrganizerValue)
        }
        onClick={onApply}
      >
        {labels.applyToSelected}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onInfer}>
        <ListFilterIcon className="size-3.5" />
        {labels.inferFromPrompt}
      </Button>
      <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={onCreateVersion}>
        {versionCreating ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <PlusIcon className="size-3.5" />}
        {labels.createVersion(nextVersionLabel)}
      </Button>
    </div>
  );
}

interface Props {
  open: boolean;
  series: PromptSeriesDto | null;
  initialOutputId: string | null;
  onOpenChange(open: boolean): void;
  onCreateVersion(seriesId: string): Promise<PromptVersionCreateResult | null>;
  onSaved(outputs: ImportedCreationOutputDto[]): Promise<void>;
  notify(message: string): void;
}

export function CreationResultsOrganizerDialog(props: Props) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  const organizer = useCreationResultsOrganizer({
    ...props,
    onClose: () => props.onOpenChange(false),
  });
  return (
    <Dialog open={props.open} onOpenChange={(next) => !organizer.busy && props.onOpenChange(next)}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] max-w-[min(96vw,86rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <div className="flex items-center gap-3">
            <DialogTitle>{labels.title}</DialogTitle>
            <span className="text-xs text-muted-foreground">{labels.outputCount(organizer.rows.length)}</span>
          </div>
        </DialogHeader>
        <div className="min-h-0 overflow-hidden">
          <OrganizerToolbar
            selectedCount={organizer.selectedIds.size}
            batchVersionValue={organizer.batchVersionValue}
            batchAiValue={organizer.batchAiValue}
            versions={organizer.versions}
            nextVersionLabel={organizer.nextVersionLabel}
            someSelected={organizer.someSelected}
            busy={organizer.busy}
            versionCreating={organizer.versionCreating}
            onBatchVersionChange={(value) => {
              if (value === createOrganizerVersionValue) {
                void organizer.createVersion([]).then((versionId) => {
                  if (versionId) organizer.setBatchVersionValue(versionId);
                });
              } else organizer.setBatchVersionValue(value);
            }}
            onBatchAiChange={organizer.setBatchAiValue}
            onApply={organizer.applyBatchValues}
            onInfer={organizer.inferFromPrompt}
            onCreateVersion={() => void organizer.createVersion([...organizer.selectedIds])}
          />
          <CreationResultsOrganizerTable
            rows={organizer.rows}
            versions={organizer.versions}
            promptVersions={props.series?.versions ?? []}
            nextVersionLabel={organizer.nextVersionLabel}
            selectedIds={organizer.selectedIds}
            busy={organizer.busy}
            onToggleAll={organizer.toggleAll}
            onToggleRow={organizer.toggleRow}
            onUpdateAll={organizer.updateAllRows}
            onUpdateRow={organizer.updateRow}
            onMoveRow={organizer.moveRow}
            onCreateVersion={(outputId) => void organizer.createVersion([outputId])}
          />
        </div>
        <DialogFooter className="items-center border-t px-5 py-3">
          <span className="mr-auto text-xs text-muted-foreground">{labels.outputCount(organizer.rows.length)}</span>
          <Button type="button" variant="outline" disabled={organizer.busy} onClick={() => props.onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={organizer.busy || organizer.invalid || !organizer.rows.length}
            onClick={() => void organizer.save()}
          >
            {organizer.saving && <LoaderCircleIcon className="size-4 animate-spin" />}
            {organizer.saving ? labels.saving : labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
