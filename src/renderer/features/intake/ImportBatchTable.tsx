import { ArrowDownIcon, ArrowUpIcon, PencilLineIcon, PlusIcon, XIcon } from 'lucide-react';
import type { PromptSeriesDto } from '@/shared/contracts';
import { comparisonPromptForVersion } from '@/renderer/components/creator/generationComparisonUtils';
import { useProvenanceSuggestions } from '@/renderer/components/provenance/useProvenanceSuggestions';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ComboboxInput, type ComboboxInputSuggestion } from '@/renderer/components/ui/combobox-input';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { ImportResultPreviewHoverCard } from '@/renderer/features/intake/ImportResultPreviewHoverCard';
import {
  isAiGeneratedStatus,
  type IntakeImageMetadataDraft,
  type IntakeImageMetadataDraftUpdate,
} from '@/renderer/features/intake/importMetadata';
import type { ImportOrganizerMediaItem } from '@/renderer/features/intake/useImportMetadataOrganizer';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

const mixedValue = '__mixed__';
const unlinkedValue = '__none__';

function sharedValue(rows: readonly IntakeImageMetadataDraft[], select: (row: IntakeImageMetadataDraft) => string) {
  const value = rows[0] ? select(rows[0]) : '';
  return rows.some((row) => select(row) !== value) ? { value: '', mixed: true } : { value, mixed: false };
}

function versionLabel(version: PromptSeriesDto['versions'][number]) {
  const base = `V${String(version.versionNo).padStart(2, '0')}`;
  return version.changeSummary.trim() ? `${base} · ${version.changeSummary.trim()}` : base;
}

function promptForDraft(draft: IntakeImageMetadataDraft, series: readonly PromptSeriesDto[], fallbackPrompt: string) {
  const recorded = draft.generationText.trim();
  if (recorded) return recorded;
  const linkedSeries = draft.seriesId ? series.find((candidate) => candidate.id === draft.seriesId) : undefined;
  const linkedVersion = draft.promptVersionId
    ? linkedSeries?.versions.find((candidate) => candidate.id === draft.promptVersionId)
    : undefined;
  return linkedVersion ? comparisonPromptForVersion(linkedVersion, null) : fallbackPrompt.trim();
}

function AiGeneratedSelect({
  value,
  disabled,
  onChange,
}: {
  value: IntakeImageMetadataDraft['aiGeneratedStatus'];
  disabled: boolean;
  onChange(value: IntakeImageMetadataDraft['aiGeneratedStatus']): void;
}) {
  const labels = useI18n().messages.intake.review;
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (isAiGeneratedStatus(next)) onChange(next);
      }}
    >
      <SelectTrigger className="h-8 w-full min-w-28 text-xs" aria-label={labels.aiGeneratedLabel}>
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

function LinkedCreationSelect({
  draft,
  series,
  disabled,
  onChange,
}: {
  draft: IntakeImageMetadataDraft;
  series: readonly PromptSeriesDto[];
  disabled: boolean;
  onChange(update: IntakeImageMetadataDraftUpdate): void;
}) {
  const labels = useI18n().messages.intake.review;
  return (
    <Select
      value={draft.seriesId ?? unlinkedValue}
      disabled={disabled}
      onValueChange={(value) => onChange({ seriesId: value === unlinkedValue ? null : value, promptVersionId: null })}
    >
      <SelectTrigger className="h-8 w-full min-w-44 text-xs" aria-label={labels.linkedCreation}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={unlinkedValue}>{labels.notLinked}</SelectItem>
        {series.map((candidate) => (
          <SelectItem key={candidate.id} value={candidate.id}>
            {candidate.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LinkedVersionSelect({
  draft,
  series,
  disabled,
  onChange,
}: {
  draft: IntakeImageMetadataDraft;
  series: readonly PromptSeriesDto[];
  disabled: boolean;
  onChange(promptVersionId: string | null): void;
}) {
  const labels = useI18n().messages.intake.review;
  const linkedSeries = draft.seriesId ? series.find((candidate) => candidate.id === draft.seriesId) : undefined;
  const versions = [...(linkedSeries?.versions ?? [])].sort((left, right) => right.versionNo - left.versionNo);
  return (
    <Select
      value={draft.promptVersionId ?? unlinkedValue}
      disabled={disabled || !draft.seriesId || versions.length === 0}
      onValueChange={(value) => onChange(value === unlinkedValue ? null : value)}
    >
      <SelectTrigger className="h-8 w-full min-w-36 text-xs" aria-label={labels.linkedPromptVersion}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={unlinkedValue}>{labels.noPromptVersion}</SelectItem>
        {versions.map((version) => (
          <SelectItem key={version.id} value={version.id}>
            {versionLabel(version)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ImportBulkRow({
  rows,
  relationshipColumns,
  busy,
  modelsForSource,
  sourcesForModel,
  onUpdate,
}: {
  rows: readonly IntakeImageMetadataDraft[];
  relationshipColumns: number;
  busy: boolean;
  modelsForSource(source: string): readonly ComboboxInputSuggestion[];
  sourcesForModel(model: string): readonly ComboboxInputSuggestion[];
  onUpdate(update: IntakeImageMetadataDraftUpdate): void;
}) {
  const { messages } = useI18n();
  const labels = messages.intake.review;
  const organizerLabels = messages.creator.resultsOrganizer;
  const aiStatuses = new Set(rows.map((row) => row.aiGeneratedStatus));
  const aiGeneratedStatus = aiStatuses.size === 1 ? rows[0]!.aiGeneratedStatus : mixedValue;
  const model = sharedValue(rows, (row) => row.modelName);
  const provider = sharedValue(rows, (row) => row.modelProvider);
  const provenanceDisabled = busy || aiGeneratedStatus === 'NO';
  return (
    <TableRow className="bg-surface-sunken/60 hover:bg-surface-sunken/60">
      <TableCell colSpan={3 + relationshipColumns} className="font-medium">
        {organizerLabels.changeAll}
      </TableCell>
      <TableCell>
        <Select
          value={aiGeneratedStatus}
          disabled={busy || rows.length === 0}
          onValueChange={(value) => {
            // Form-backed selects can emit an empty value while native options mount.
            if (isAiGeneratedStatus(value)) onUpdate({ aiGeneratedStatus: value });
          }}
        >
          <SelectTrigger className="h-8 w-full min-w-28 text-xs" aria-label={labels.changeAllAiGenerated}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {aiGeneratedStatus === mixedValue && (
              <SelectItem value={mixedValue}>{organizerLabels.mixedValues}</SelectItem>
            )}
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
          placeholder={model.mixed ? organizerLabels.mixedValues : labels.model}
          aria-label={labels.changeAllModel}
          maxLength={300}
          disabled={provenanceDisabled || rows.length === 0}
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
          placeholder={provider.mixed ? organizerLabels.mixedValues : labels.platform}
          aria-label={labels.changeAllPlatform}
          maxLength={200}
          disabled={provenanceDisabled || rows.length === 0}
          onValueChange={(modelProvider) => onUpdate({ modelProvider })}
        />
      </TableCell>
      <TableCell colSpan={2} aria-hidden="true" />
    </TableRow>
  );
}

interface Props {
  items: readonly ImportOrganizerMediaItem[];
  drafts: Readonly<Record<string, IntakeImageMetadataDraft>>;
  series: readonly PromptSeriesDto[];
  selectedIds: ReadonlySet<string>;
  busy: boolean;
  relationshipsEnabled: boolean;
  fallbackPrompt?: string;
  onToggle(id: string, selected: boolean): void;
  onToggleAll(selected: boolean): void;
  onUpdateRow(id: string, update: IntakeImageMetadataDraftUpdate): void;
  onUpdateAll(update: IntakeImageMetadataDraftUpdate): void;
  onMove(id: string, direction: -1 | 1): void;
  onEditDetails(id: string): void;
  onEditSelected(): void;
  onRemove(id: string): void;
  onAddContent(): void;
}

export function ImportBatchTable({
  items,
  drafts,
  series,
  selectedIds,
  busy,
  relationshipsEnabled,
  fallbackPrompt = '',
  onToggle,
  onToggleAll,
  onUpdateRow,
  onUpdateAll,
  onMove,
  onEditDetails,
  onEditSelected,
  onRemove,
  onAddContent,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.intake.review;
  const organizerLabels = messages.creator.resultsOrganizer;
  const provenanceSuggestions = useProvenanceSuggestions(items.length > 0);
  const rows = items.flatMap((item) => (drafts[item.id] ? [{ item, draft: drafts[item.id] }] : []));
  const allSelected = rows.length > 0 && rows.every(({ item }) => selectedIds.has(item.id));
  const someSelected = rows.some(({ item }) => selectedIds.has(item.id));
  const relationshipColumns = relationshipsEnabled ? 2 : 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-overlay" data-slot="import-batch-table">
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-surface-sunken/60 px-4 py-2.5">
        <span className="mr-1 text-xs text-muted-foreground">{labels.selected(selectedIds.size)}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || selectedIds.size < 2}
          onClick={onEditSelected}
        >
          <PencilLineIcon className="size-3.5" />
          {labels.batchFill}
        </Button>
        <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={onAddContent}>
          <PlusIcon className="size-3.5" />
          {labels.addContent}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table className={cn(relationshipsEnabled ? 'min-w-[112rem]' : 'min-w-[82rem]')}>
          <TableHeader className="sticky top-0 z-10 bg-overlay">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label={labels.selectAll}
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  disabled={busy || rows.length === 0}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
              </TableHead>
              <TableHead className="w-16">{labels.preview}</TableHead>
              <TableHead className="min-w-52">{labels.name}</TableHead>
              {relationshipsEnabled && (
                <>
                  <TableHead className="min-w-48">{labels.linkedCreation}</TableHead>
                  <TableHead className="min-w-40">{labels.linkedPromptVersion}</TableHead>
                </>
              )}
              <TableHead className="min-w-32">{labels.aiGeneratedLabel}</TableHead>
              <TableHead className="min-w-52">{labels.model}</TableHead>
              <TableHead className="min-w-52">{labels.platform}</TableHead>
              <TableHead className="w-24 text-center">{organizerLabels.order}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <ImportBulkRow
              rows={rows.map(({ draft }) => draft)}
              relationshipColumns={relationshipColumns}
              busy={busy}
              modelsForSource={provenanceSuggestions.modelsForSource}
              sourcesForModel={provenanceSuggestions.sourcesForModel}
              onUpdate={onUpdateAll}
            />
            {rows.map(({ item, draft }, index) => {
              const below = rows[index + 1];
              const relationshipDisabled = busy || item.kind !== 'IMAGE';
              return (
                <TableRow key={item.id} data-state={selectedIds.has(item.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={labels.selectItem(draft.displayName)}
                      checked={selectedIds.has(item.id)}
                      disabled={busy}
                      onCheckedChange={(checked) => onToggle(item.id, checked === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <ImportResultPreviewHoverCard
                      src={item.previewUrl}
                      name={draft.displayName}
                      prompt={promptForDraft(draft, series, fallbackPrompt)}
                      below={
                        below
                          ? {
                              name: below.draft.displayName,
                              prompt: promptForDraft(below.draft, series, fallbackPrompt),
                            }
                          : undefined
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={draft.displayName}
                      maxLength={500}
                      disabled={busy}
                      onChange={(event) => onUpdateRow(item.id, { displayName: event.target.value })}
                    />
                  </TableCell>
                  {relationshipsEnabled && (
                    <>
                      <TableCell>
                        <LinkedCreationSelect
                          draft={draft}
                          series={series}
                          disabled={relationshipDisabled}
                          onChange={(update) => onUpdateRow(item.id, update)}
                        />
                      </TableCell>
                      <TableCell>
                        <LinkedVersionSelect
                          draft={draft}
                          series={series}
                          disabled={relationshipDisabled}
                          onChange={(promptVersionId) => onUpdateRow(item.id, { promptVersionId })}
                        />
                      </TableCell>
                    </>
                  )}
                  <TableCell>
                    <AiGeneratedSelect
                      value={draft.aiGeneratedStatus}
                      disabled={busy}
                      onChange={(aiGeneratedStatus) => onUpdateRow(item.id, { aiGeneratedStatus })}
                    />
                  </TableCell>
                  <TableCell>
                    <ComboboxInput
                      className="min-w-48"
                      value={draft.modelName}
                      suggestions={provenanceSuggestions.modelsForSource(draft.modelProvider)}
                      openLabel={labels.modelOptions}
                      placeholder={labels.model}
                      maxLength={300}
                      disabled={busy || draft.aiGeneratedStatus === 'NO'}
                      onValueChange={(modelName) => onUpdateRow(item.id, { modelName })}
                    />
                  </TableCell>
                  <TableCell>
                    <ComboboxInput
                      className="min-w-48"
                      value={draft.modelProvider}
                      suggestions={provenanceSuggestions.sourcesForModel(draft.modelName)}
                      openLabel={labels.platformOptions}
                      placeholder={labels.platform}
                      maxLength={200}
                      disabled={busy || draft.aiGeneratedStatus === 'NO'}
                      onValueChange={(modelProvider) => onUpdateRow(item.id, { modelProvider })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={organizerLabels.moveUp}
                        aria-label={organizerLabels.moveUp}
                        disabled={busy || index === 0}
                        onClick={() => onMove(item.id, -1)}
                      >
                        <ArrowUpIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={organizerLabels.moveDown}
                        aria-label={organizerLabels.moveDown}
                        disabled={busy || index === rows.length - 1}
                        onClick={() => onMove(item.id, 1)}
                      >
                        <ArrowDownIcon className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={labels.editDetails}
                        aria-label={labels.editDetailsFor(draft.displayName)}
                        disabled={busy}
                        onClick={() => onEditDetails(item.id)}
                      >
                        <PencilLineIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={messages.intake.draft.remove}
                        aria-label={`${messages.intake.draft.remove}: ${draft.displayName}`}
                        disabled={busy}
                        onClick={() => onRemove(item.id)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
