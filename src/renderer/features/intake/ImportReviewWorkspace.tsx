import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PromptSeriesDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/catalog';
import { useProvenanceSuggestions } from '@/renderer/components/provenance/useProvenanceSuggestions';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';
import { isCreatorImageMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { ImportItemList } from '@/renderer/features/intake/ImportItemList';
import { ImportMetadataEditor } from '@/renderer/features/intake/ImportMetadataEditor';
import {
  createIntakeImageMetadataDraft,
  defaultBatchMetadataFields,
  imageDetailsFromDrafts,
  updateAiGeneratedStatus,
  type BatchMetadataField,
  type IntakeImageDetails,
  type IntakeImageMetadataDraft,
} from '@/renderer/features/intake/importMetadata';

interface Props {
  items: LocalIntakeItem[];
  series: PromptSeriesDto[];
  favorite: boolean;
  disabled: boolean;
  importingMaterial: boolean;
  importingCreation: boolean;
  error: string;
  skippedCount: number;
  onFavoriteChange(value: boolean): void;
  onEditText(id: string, text: string): void;
  onRemove(id: string): void;
  onAddFiles(files: File[]): void;
  onImport(details: IntakeImageDetails): void;
  onImportAsCreation(details: IntakeImageDetails): void;
  onCancel(): void;
}

function applyBatchFields(
  target: IntakeImageMetadataDraft,
  source: IntakeImageMetadataDraft,
  fields: ReadonlySet<BatchMetadataField>,
) {
  let next = { ...target };
  if (fields.has('displayName')) next.displayName = source.displayName;
  if (fields.has('sourceUrl')) next.sourceUrl = source.sourceUrl;
  if (fields.has('note')) next.note = source.note;
  if (fields.has('aiGeneratedStatus')) next = updateAiGeneratedStatus(next, source.aiGeneratedStatus);
  if (fields.has('modelName')) {
    next.modelName = source.modelName;
    next.modelKey = source.modelKey;
    if (source.modelName.trim() && next.aiGeneratedStatus === 'UNKNOWN') {
      next = updateAiGeneratedStatus(next, 'YES');
      next.modelName = source.modelName;
      next.modelKey = source.modelKey;
    }
  }
  if (fields.has('modelProvider')) next.modelProvider = source.modelProvider;
  if (fields.has('modelVersion')) next.modelVersion = source.modelVersion;
  if (fields.has('generationText')) {
    next.generationText = source.generationText;
    next.generationTextType = source.generationTextType;
  }
  if (fields.has('seriesId')) {
    const changedSeries = next.seriesId !== source.seriesId;
    next.seriesId = source.seriesId;
    if (changedSeries && !fields.has('promptVersionId')) next.promptVersionId = null;
  }
  if (fields.has('promptVersionId')) {
    next.promptVersionId = next.seriesId === source.seriesId ? source.promptVersionId : null;
  }
  if (next.aiGeneratedStatus === 'NO') {
    next.modelKey = null;
    next.modelName = '';
    next.modelProvider = '';
    next.modelVersion = '';
  }
  if (!next.seriesId) next.promptVersionId = null;
  return next;
}

function provenancePlatformDefaults(labels: MessageCatalog['creator']['generationRecord']) {
  return [
    labels.platformOfficialApi,
    labels.platformOpenRouter,
    labels.platformChatGptApp,
    labels.platformCodex,
    labels.platformGeminiApp,
    labels.platformDoubao,
    labels.platformLocal,
  ];
}

export function ImportReviewWorkspace({
  items,
  series,
  favorite,
  disabled,
  importingMaterial,
  importingCreation,
  error,
  skippedCount,
  onFavoriteChange,
  onEditText,
  onRemove,
  onAddFiles,
  onImport,
  onImportAsCreation,
  onCancel,
}: Props) {
  const { locale, messages } = useI18n();
  const labels = messages.intake.review;
  const recordLabels = messages.creator.generationRecord;
  const imageItems = useMemo(
    () => items.filter((item): item is Extract<LocalIntakeItem, { kind: 'IMAGE' }> => item.kind === 'IMAGE'),
    [items],
  );
  const imageIds = useMemo(() => new Set(imageItems.map((item) => item.id)), [imageItems]);
  const knownImageIds = useRef(new Set<string>());
  const [activeId, setActiveId] = useState(items[0]?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(imageItems.map((item) => item.id)));
  const [drafts, setDrafts] = useState<Record<string, IntakeImageMetadataDraft>>(() =>
    Object.fromEntries(imageItems.map((item) => [item.id, createIntakeImageMetadataDraft(item)])),
  );
  const [batchMode, setBatchMode] = useState(false);
  const [batchDraft, setBatchDraft] = useState<IntakeImageMetadataDraft | null>(null);
  const [batchFields, setBatchFields] = useState<Set<BatchMetadataField>>(() => new Set(defaultBatchMetadataFields));

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, IntakeImageMetadataDraft> = {};
      for (const item of imageItems) next[item.id] = current[item.id] ?? createIntakeImageMetadataDraft(item);
      return next;
    });
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => imageIds.has(id)));
      for (const id of imageIds) if (!knownImageIds.current.has(id)) next.add(id);
      return next;
    });
    knownImageIds.current = imageIds;
    setActiveId((current) => (items.some((item) => item.id === current) ? current : (items[0]?.id ?? '')));
  }, [imageIds, imageItems, items]);

  const selectedImageIds = imageItems.map((item) => item.id).filter((id) => selectedIds.has(id));
  const selectedCount = selectedImageIds.length;
  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const activeDraft = activeItem?.kind === 'IMAGE' ? drafts[activeItem.id] : undefined;
  const editorDraft = batchMode ? batchDraft : activeDraft;
  const allNamesValid = imageItems.every((item) => Boolean(drafts[item.id]?.displayName.trim()));
  const hasExistingRelationship = Object.values(drafts).some((draft) => Boolean(draft.seriesId));
  const canImportCreation =
    imageItems.length > 0 &&
    imageItems.length <= 8 &&
    imageItems.every((item) => isCreatorImageMimeType(item.mimeType)) &&
    !hasExistingRelationship;
  const kind =
    imageItems.length === items.length ? labels.images : imageItems.length === 0 ? labels.text : labels.mixed;
  const provenanceSuggestions = useProvenanceSuggestions(
    provenancePlatformDefaults(recordLabels),
    imageItems.length > 0,
  );

  useEffect(() => {
    if (selectedCount < 2 && batchMode) {
      setBatchMode(false);
      setBatchDraft(null);
    }
  }, [batchMode, selectedCount]);

  function enterBatch() {
    const sourceId = selectedImageIds.includes(activeId) ? activeId : selectedImageIds[0];
    const source = sourceId ? drafts[sourceId] : undefined;
    if (!source || selectedCount < 2) return;
    setBatchDraft({ ...source });
    setBatchFields(new Set(defaultBatchMetadataFields));
    setBatchMode(true);
  }

  function applyBatch() {
    if (!batchDraft || selectedCount < 1) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const id of selectedImageIds) {
        const target = next[id];
        if (target) next[id] = applyBatchFields(target, batchDraft, batchFields);
      }
      return next;
    });
    setBatchMode(false);
    setBatchDraft(null);
  }

  function submitDefault(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'Enter' ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      disabled ||
      !allNamesValid
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('button, input, textarea, select, [contenteditable="true"]')
    )
      return;
    event.preventDefault();
    onImport(imageDetailsFromDrafts(drafts));
  }

  return (
    <div
      className="grid size-full min-h-0 grid-rows-[6rem_minmax(0,1fr)_4.5rem] outline-none"
      data-slot="import-review-workspace"
      data-batch-mode={batchMode ? 'true' : 'false'}
      tabIndex={-1}
      onKeyDown={submitDefault}
    >
      <header className="flex flex-col justify-center border-b px-8 pr-16">
        <h1 className="text-xl font-semibold tracking-tight">{labels.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{labels.summary(items.length, kind)}</p>
      </header>

      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(18rem,36%)_minmax(0,1fr)]">
        <ImportItemList
          items={items}
          activeId={activeItem?.id ?? ''}
          selectedIds={selectedIds}
          batchMode={batchMode}
          disabled={disabled}
          locale={locale}
          labels={{
            selectAll: labels.selectAll,
            selected: labels.selected,
            addContent: labels.addContent,
            remove: messages.intake.draft.remove,
            text: labels.text,
          }}
          onActiveChange={setActiveId}
          onSelectionChange={(id, selected) =>
            setSelectedIds((current) => {
              const next = new Set(current);
              if (selected) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onSelectAll={(selected) => setSelectedIds(selected ? new Set(imageIds) : new Set())}
          onRemove={onRemove}
          onAddFiles={onAddFiles}
        />

        {activeItem?.kind === 'TEXT' ? (
          <section className="flex min-h-0 flex-col bg-overlay">
            <header className="flex min-h-14 items-center border-b px-6">
              <h2 className="text-sm font-semibold">{labels.text}</h2>
            </header>
            <div className="min-h-0 flex-1 p-6">
              <Textarea
                className="h-full min-h-48 resize-none"
                value={activeItem.text}
                disabled={disabled}
                aria-label={labels.text}
                onChange={(event) => onEditText(activeItem.id, event.target.value)}
              />
            </div>
          </section>
        ) : editorDraft && activeItem ? (
          <ImportMetadataEditor
            key={batchMode ? 'batch' : activeItem.id}
            title={activeItem.kind === 'IMAGE' ? activeItem.name : labels.text}
            draft={editorDraft}
            series={series}
            modelSuggestions={provenanceSuggestions.modelNames}
            platformSuggestions={provenanceSuggestions.platforms}
            batchMode={batchMode}
            batchCount={selectedCount}
            batchFields={batchFields}
            disabled={disabled}
            labels={{
              ...labels,
              modelOptions: recordLabels.modelOptions,
              platformOptions: recordLabels.platformOptions,
            }}
            onChange={(draft) => {
              if (batchMode) setBatchDraft(draft);
              else if (activeItem.kind === 'IMAGE') setDrafts((current) => ({ ...current, [activeItem.id]: draft }));
            }}
            onBatchFieldChange={(field, enabled) =>
              setBatchFields((current) => {
                const next = new Set(current);
                if (enabled) next.add(field);
                else next.delete(field);
                return next;
              })
            }
            onEnterBatch={enterBatch}
            onExitBatch={() => {
              setBatchMode(false);
              setBatchDraft(null);
            }}
            onApplyBatch={applyBatch}
          />
        ) : (
          <div className="bg-overlay" />
        )}
      </div>

      <footer className="flex min-w-0 items-center gap-3 border-t bg-overlay px-8">
        <label className="mr-auto flex items-center gap-2 text-sm">
          <Checkbox
            checked={favorite}
            disabled={disabled}
            onCheckedChange={(checked) => onFavoriteChange(checked === true)}
          />
          {labels.favorite}
        </label>
        <div className="min-w-0 flex-1 text-right text-xs text-destructive" role="alert">
          {error || (skippedCount > 0 ? labels.skipped(skippedCount) : '')}
        </div>
        <Button
          type="button"
          data-action="intake-start-creation"
          variant="outline"
          disabled={disabled || !canImportCreation}
          aria-busy={importingCreation}
          onClick={() => onImportAsCreation(imageDetailsFromDrafts(drafts))}
        >
          {importingCreation && <LoaderCircleIcon className="size-4 animate-spin" />}
          {labels.importAsCreation}
        </Button>
        <Button type="button" data-action="intake-cancel" variant="outline" disabled={disabled} onClick={onCancel}>
          {labels.cancel}
        </Button>
        <Button
          type="button"
          data-action="intake-import"
          disabled={disabled || !allNamesValid || items.length === 0}
          aria-busy={importingMaterial}
          onClick={() => onImport(imageDetailsFromDrafts(drafts))}
        >
          {importingMaterial && <LoaderCircleIcon className="size-4 animate-spin" />}
          {labels.importItems(items.length)}
        </Button>
      </footer>
    </div>
  );
}
