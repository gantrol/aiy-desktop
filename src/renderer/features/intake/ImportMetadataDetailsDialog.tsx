import type { PromptSeriesDto } from '@/shared/contracts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useProvenanceSuggestions } from '@/renderer/components/provenance/useProvenanceSuggestions';
import { ImportMetadataEditor } from '@/renderer/features/intake/ImportMetadataEditor';
import type { BatchMetadataField, IntakeImageMetadataDraft } from '@/renderer/features/intake/importMetadata';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  title: string;
  draft: IntakeImageMetadataDraft | null | undefined;
  series: PromptSeriesDto[];
  batchMode: boolean;
  batchCount: number;
  batchFields: ReadonlySet<BatchMetadataField>;
  relationshipEnabled: boolean;
  disabled: boolean;
  onOpenChange(open: boolean): void;
  onChange(draft: IntakeImageMetadataDraft): void;
  onBatchFieldChange(field: BatchMetadataField, enabled: boolean): void;
  onEnterBatch(): void;
  onExitBatch(): void;
  onApplyBatch(): void;
}

export function ImportMetadataDetailsDialog({
  open,
  title,
  draft,
  series,
  batchMode,
  batchCount,
  batchFields,
  relationshipEnabled,
  disabled,
  onOpenChange,
  onChange,
  onBatchFieldChange,
  onEnterBatch,
  onExitBatch,
  onApplyBatch,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.intake.review;
  const recordLabels = messages.creator.generationRecord;
  const provenanceSuggestions = useProvenanceSuggestions(Boolean(draft));
  return (
    <Dialog open={open && Boolean(draft)} onOpenChange={(next) => !disabled && onOpenChange(next)}>
      <DialogContent className="h-[min(46rem,calc(100vh-3rem))] max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{batchMode ? labels.batchTitle(batchCount) : title}</DialogTitle>
        </DialogHeader>
        {draft && (
          <ImportMetadataEditor
            title={title}
            draft={draft}
            series={series}
            modelSuggestions={provenanceSuggestions.modelsForSource(draft.modelProvider)}
            sourceSuggestions={provenanceSuggestions.sourcesForModel(draft.modelName)}
            batchMode={batchMode}
            batchCount={batchCount}
            batchFields={batchFields}
            relationshipEnabled={relationshipEnabled}
            disabled={disabled}
            labels={{
              ...labels,
              modelOptions: recordLabels.modelOptions,
              platformOptions: recordLabels.platformOptions,
            }}
            onChange={onChange}
            onBatchFieldChange={onBatchFieldChange}
            onEnterBatch={onEnterBatch}
            onExitBatch={onExitBatch}
            onApplyBatch={onApplyBatch}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
