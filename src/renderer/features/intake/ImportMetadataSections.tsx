import type { ReactNode } from 'react';
import type { PromptSeriesDto } from '@/shared/contracts';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ComboboxInput, type ComboboxInputSuggestionValue } from '@/renderer/components/ui/combobox-input';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { cn } from '@/renderer/lib/utils';
import {
  updateAiGeneratedStatus,
  type BatchMetadataField,
  type IntakeImageMetadataDraft,
} from '@/renderer/features/intake/importMetadata';

export interface ImportMetadataEditorLabels {
  batchFill: string;
  batchTitle(count: number): string;
  exitBatch: string;
  overwriteHint: string;
  applyBatch(count: number): string;
  basicInformation: string;
  name: string;
  sourceUrl: string;
  note: string;
  aiGeneratedSection: string;
  aiGeneratedLabel: string;
  aiYes: string;
  aiNo: string;
  aiUnknown: string;
  aiOther: string;
  model: string;
  platform: string;
  version: string;
  exactPrompt: string;
  description: string;
  reconstructedPrompt: string;
  generationText: string;
  relationships: string;
  linkedCreation: string;
  notLinked: string;
  linkedPromptVersion: string;
  noPromptVersion: string;
  modelOptions: string;
  platformOptions: string;
}

interface SharedSectionProps {
  draft: IntakeImageMetadataDraft;
  series: PromptSeriesDto[];
  modelSuggestions: readonly ComboboxInputSuggestionValue[];
  sourceSuggestions: readonly ComboboxInputSuggestionValue[];
  batchMode: boolean;
  batchFields: ReadonlySet<BatchMetadataField>;
  disabled: boolean;
  labels: ImportMetadataEditorLabels;
  onChange(draft: IntakeImageMetadataDraft): void;
  onBatchFieldChange(field: BatchMetadataField, enabled: boolean): void;
}

interface FieldProps {
  field: BatchMetadataField;
  label: string;
  batchMode: boolean;
  batchFields: ReadonlySet<BatchMetadataField>;
  disabled: boolean;
  onBatchFieldChange(field: BatchMetadataField, enabled: boolean): void;
  children(disabled: boolean): ReactNode;
}

function MetadataField({ field, label, batchMode, batchFields, disabled, onBatchFieldChange, children }: FieldProps) {
  const fieldEnabled = !batchMode || batchFields.has(field);
  const controlDisabled = disabled || !fieldEnabled;
  return (
    <div className="grid min-w-0 grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-4">
      <label className={cn('flex min-h-9 items-center gap-2 text-sm', controlDisabled && 'text-disabled-foreground')}>
        {batchMode && (
          <Checkbox
            checked={fieldEnabled}
            disabled={disabled}
            aria-label={label}
            onCheckedChange={(checked) => onBatchFieldChange(field, checked === true)}
          />
        )}
        <span>{label}</span>
      </label>
      {children(controlDisabled)}
    </div>
  );
}

export function BasicMetadataSection({
  draft,
  batchMode,
  batchFields,
  disabled,
  labels,
  onChange,
  onBatchFieldChange,
}: SharedSectionProps) {
  const fields = { batchMode, batchFields, disabled, onBatchFieldChange };
  return (
    <section className="space-y-3" aria-labelledby="import-basic-information">
      <h3 id="import-basic-information" className="text-sm font-semibold">
        {labels.basicInformation}
      </h3>
      <MetadataField field="displayName" label={labels.name} {...fields}>
        {(fieldDisabled) => (
          <Input
            value={draft.displayName}
            disabled={fieldDisabled}
            aria-label={labels.name}
            onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
          />
        )}
      </MetadataField>
      <MetadataField field="sourceUrl" label={labels.sourceUrl} {...fields}>
        {(fieldDisabled) => (
          <Input
            type="url"
            value={draft.sourceUrl}
            disabled={fieldDisabled}
            aria-label={labels.sourceUrl}
            onChange={(event) => onChange({ ...draft, sourceUrl: event.target.value })}
          />
        )}
      </MetadataField>
      <MetadataField field="note" label={labels.note} {...fields}>
        {(fieldDisabled) => (
          <Textarea
            className="min-h-16"
            value={draft.note}
            disabled={fieldDisabled}
            aria-label={labels.note}
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
          />
        )}
      </MetadataField>
    </section>
  );
}

export function AiMetadataSection({
  draft,
  modelSuggestions,
  sourceSuggestions,
  batchMode,
  batchFields,
  disabled,
  labels,
  onChange,
  onBatchFieldChange,
}: SharedSectionProps) {
  const modelDisabled = draft.aiGeneratedStatus === 'NO';
  const generationTextLabel =
    draft.generationTextType === 'EXACT_PROMPT'
      ? labels.exactPrompt
      : draft.generationTextType === 'DESCRIPTION'
        ? labels.description
        : draft.generationTextType === 'RECONSTRUCTION'
          ? labels.reconstructedPrompt
          : labels.generationText;
  const fields = { batchMode, batchFields, disabled, onBatchFieldChange };

  function changeModelName(modelName: string) {
    onChange({
      ...(draft.aiGeneratedStatus === 'UNKNOWN' ? updateAiGeneratedStatus(draft, 'YES') : draft),
      modelName,
    });
  }

  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="import-ai-generated">
      <h3 id="import-ai-generated" className="text-sm font-semibold">
        {labels.aiGeneratedSection}
      </h3>
      <MetadataField field="aiGeneratedStatus" label={labels.aiGeneratedLabel} {...fields}>
        {(fieldDisabled) => (
          <Select
            value={draft.aiGeneratedStatus}
            disabled={fieldDisabled}
            onValueChange={(value) =>
              onChange(updateAiGeneratedStatus(draft, value as IntakeImageMetadataDraft['aiGeneratedStatus']))
            }
          >
            <SelectTrigger aria-label={labels.aiGeneratedLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UNKNOWN">{labels.aiUnknown}</SelectItem>
              <SelectItem value="YES">{labels.aiYes}</SelectItem>
              <SelectItem value="NO">{labels.aiNo}</SelectItem>
              <SelectItem value="OTHER">{labels.aiOther}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </MetadataField>
      <div className="grid min-w-0 grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-4">
        <div />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem] gap-2">
          <ModelField
            field="modelName"
            label={labels.model}
            batchMode={batchMode}
            checked={batchFields.has('modelName')}
            checkboxDisabled={disabled}
            onBatchFieldChange={onBatchFieldChange}
          >
            <ComboboxInput
              className="min-w-0 flex-1"
              value={draft.modelName}
              suggestions={modelSuggestions}
              disabled={disabled || modelDisabled || (batchMode && !batchFields.has('modelName'))}
              aria-label={labels.model}
              placeholder={labels.model}
              openLabel={labels.modelOptions}
              onValueChange={changeModelName}
            />
          </ModelField>
          <ModelField
            field="modelProvider"
            label={labels.platform}
            batchMode={batchMode}
            checked={batchFields.has('modelProvider')}
            checkboxDisabled={disabled}
            onBatchFieldChange={onBatchFieldChange}
          >
            <ComboboxInput
              className="min-w-0 flex-1"
              value={draft.modelProvider}
              suggestions={sourceSuggestions}
              disabled={disabled || modelDisabled || (batchMode && !batchFields.has('modelProvider'))}
              aria-label={labels.platform}
              placeholder={labels.platform}
              openLabel={labels.platformOptions}
              onValueChange={(modelProvider) => onChange({ ...draft, modelProvider })}
            />
          </ModelField>
          <ModelField
            field="modelVersion"
            label={labels.version}
            batchMode={batchMode}
            checked={batchFields.has('modelVersion')}
            checkboxDisabled={disabled}
            onBatchFieldChange={onBatchFieldChange}
          >
            <Input
              value={draft.modelVersion}
              disabled={disabled || modelDisabled || (batchMode && !batchFields.has('modelVersion'))}
              aria-label={labels.version}
              onChange={(event) => onChange({ ...draft, modelVersion: event.target.value })}
            />
          </ModelField>
        </div>
      </div>
      <MetadataField field="generationText" label={generationTextLabel} {...fields}>
        {(fieldDisabled) => (
          <Textarea
            className="min-h-20"
            value={draft.generationText}
            disabled={fieldDisabled}
            aria-label={generationTextLabel}
            onChange={(event) => onChange({ ...draft, generationText: event.target.value })}
          />
        )}
      </MetadataField>
    </section>
  );
}

interface ModelFieldProps {
  field: 'modelName' | 'modelProvider' | 'modelVersion';
  label: string;
  batchMode: boolean;
  checked: boolean;
  checkboxDisabled: boolean;
  onBatchFieldChange(field: BatchMetadataField, enabled: boolean): void;
  children: ReactNode;
}

function ModelField({
  field,
  label,
  batchMode,
  checked,
  checkboxDisabled,
  onBatchFieldChange,
  children,
}: ModelFieldProps) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {batchMode && (
          <Checkbox
            checked={checked}
            disabled={checkboxDisabled}
            aria-label={label}
            onCheckedChange={(value) => onBatchFieldChange(field, value === true)}
          />
        )}
        {children}
      </div>
    </div>
  );
}

function versionLabel(version: PromptSeriesDto['versions'][number]) {
  const prefix = `V${String(version.versionNo).padStart(2, '0')}`;
  const summary = version.changeSummary.trim();
  return summary ? `${prefix} · ${summary}` : prefix;
}

export function RelationshipMetadataSection({
  draft,
  series,
  batchMode,
  batchFields,
  disabled,
  labels,
  onChange,
  onBatchFieldChange,
}: SharedSectionProps) {
  const linkedSeries = draft.seriesId ? series.find((candidate) => candidate.id === draft.seriesId) : undefined;
  const versions = [...(linkedSeries?.versions ?? [])].sort((left, right) => right.versionNo - left.versionNo);
  const fields = { batchMode, batchFields, disabled, onBatchFieldChange };
  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="import-relationships">
      <h3 id="import-relationships" className="text-sm font-semibold">
        {labels.relationships}
      </h3>
      <MetadataField field="seriesId" label={labels.linkedCreation} {...fields}>
        {(fieldDisabled) => (
          <Select
            value={draft.seriesId ?? '__none'}
            disabled={fieldDisabled}
            onValueChange={(value) =>
              onChange({ ...draft, seriesId: value === '__none' ? null : value, promptVersionId: null })
            }
          >
            <SelectTrigger aria-label={labels.linkedCreation}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{labels.notLinked}</SelectItem>
              {series.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </MetadataField>
      <MetadataField
        field="promptVersionId"
        label={labels.linkedPromptVersion}
        {...fields}
        disabled={disabled || !draft.seriesId || versions.length === 0}
      >
        {(fieldDisabled) => (
          <Select
            value={draft.promptVersionId ?? '__none'}
            disabled={fieldDisabled}
            onValueChange={(value) => onChange({ ...draft, promptVersionId: value === '__none' ? null : value })}
          >
            <SelectTrigger aria-label={labels.linkedPromptVersion}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{labels.noPromptVersion}</SelectItem>
              {versions.map((version) => (
                <SelectItem key={version.id} value={version.id}>
                  {versionLabel(version)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </MetadataField>
    </section>
  );
}
