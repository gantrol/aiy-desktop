import { PencilLineIcon } from 'lucide-react';
import type { PromptSeriesDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import type { ComboboxInputSuggestionValue } from '@/renderer/components/ui/combobox-input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type { BatchMetadataField, IntakeImageMetadataDraft } from '@/renderer/features/intake/importMetadata';
import {
  AiMetadataSection,
  BasicMetadataSection,
  RelationshipMetadataSection,
  type ImportMetadataEditorLabels,
} from '@/renderer/features/intake/ImportMetadataSections';

interface Props {
  title: string;
  draft: IntakeImageMetadataDraft;
  series: PromptSeriesDto[];
  modelSuggestions: readonly ComboboxInputSuggestionValue[];
  sourceSuggestions: readonly ComboboxInputSuggestionValue[];
  batchMode: boolean;
  batchCount: number;
  batchFields: ReadonlySet<BatchMetadataField>;
  relationshipEnabled: boolean;
  disabled: boolean;
  labels: ImportMetadataEditorLabels;
  onChange(draft: IntakeImageMetadataDraft): void;
  onBatchFieldChange(field: BatchMetadataField, enabled: boolean): void;
  onEnterBatch(): void;
  onExitBatch(): void;
  onApplyBatch(): void;
}

export function ImportMetadataEditor({
  title,
  draft,
  series,
  modelSuggestions,
  sourceSuggestions,
  batchMode,
  batchCount,
  batchFields,
  relationshipEnabled,
  disabled,
  labels,
  onChange,
  onBatchFieldChange,
  onEnterBatch,
  onExitBatch,
  onApplyBatch,
}: Props) {
  const sectionProps = {
    draft,
    series,
    modelSuggestions,
    sourceSuggestions,
    batchMode,
    batchFields,
    disabled,
    labels,
    onChange,
    onBatchFieldChange,
  };
  return (
    <section className="flex min-h-0 flex-col bg-overlay" data-slot="import-metadata-editor">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-6">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{batchMode ? labels.batchTitle(batchCount) : title}</h2>
          {batchMode && <p className="mt-0.5 text-xs text-muted-foreground">{labels.overwriteHint}</p>}
        </div>
        {batchMode ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onExitBatch}>
            {labels.exitBatch}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || batchCount < 2}
            onClick={onEnterBatch}
          >
            <PencilLineIcon className="size-3.5" />
            {labels.batchFill}
          </Button>
        )}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 px-6 py-5">
          <BasicMetadataSection {...sectionProps} />
          <AiMetadataSection {...sectionProps} />
          {relationshipEnabled && <RelationshipMetadataSection {...sectionProps} />}
        </div>
      </ScrollArea>
      {batchMode && (
        <div className="flex min-h-14 shrink-0 items-center justify-end border-t bg-overlay px-6">
          <Button type="button" variant="outline" disabled={disabled || batchCount < 1} onClick={onApplyBatch}>
            {labels.applyBatch(batchCount)}
          </Button>
        </div>
      )}
    </section>
  );
}
