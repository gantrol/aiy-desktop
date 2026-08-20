import { FileTextIcon, LoaderCircleIcon, PlusIcon, XIcon } from 'lucide-react';
import { useMemo, useRef, type KeyboardEvent } from 'react';
import type { PromptSeriesDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Textarea } from '@/renderer/components/ui/textarea';
import { ImportBatchTable } from '@/renderer/features/intake/ImportBatchTable';
import { ImportMetadataDetailsDialog } from '@/renderer/features/intake/ImportMetadataDetailsDialog';
import { imageDetailsFromDrafts } from '@/renderer/features/intake/importMetadata';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';
import { intakeMediaAccept, isCreatorImageMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { useImportMetadataOrganizer } from '@/renderer/features/intake/useImportMetadataOrganizer';
import { useI18n } from '@/renderer/i18n/useI18n';

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
  onMove(id: string, offset: -1 | 1): void;
  onRemove(id: string): void;
  onAddFiles(files: File[]): void;
  onImport(details: ReturnType<typeof imageDetailsFromDrafts>): void;
  onImportAsCreation(details: ReturnType<typeof imageDetailsFromDrafts>): void;
  onCancel(): void;
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
  onMove,
  onRemove,
  onAddFiles,
  onImport,
  onImportAsCreation,
  onCancel,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.intake.review;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mediaItems = useMemo(
    () => items.filter((item): item is Exclude<LocalIntakeItem, { kind: 'TEXT' }> => item.kind !== 'TEXT'),
    [items],
  );
  const textItems = items.filter((item): item is Extract<LocalIntakeItem, { kind: 'TEXT' }> => item.kind === 'TEXT');
  const organizer = useImportMetadataOrganizer(mediaItems);
  const allNamesValid = mediaItems.every((item) => Boolean(organizer.drafts[item.id]?.displayName.trim()));
  const hasExistingRelationship = mediaItems.some((item) => Boolean(organizer.drafts[item.id]?.seriesId));
  const relationshipEnabled = organizer.batchMode
    ? organizer.selectedItems.every((item) => item.kind === 'IMAGE')
    : organizer.editingItem?.kind === 'IMAGE';
  const canImportCreation =
    mediaItems.length > 0 &&
    mediaItems.length <= 8 &&
    mediaItems.every((item) => item.kind === 'IMAGE' && isCreatorImageMimeType(item.mimeType)) &&
    !hasExistingRelationship;
  const kind =
    mediaItems.length === items.length ? labels.images : mediaItems.length === 0 ? labels.text : labels.mixed;

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
    onImport(imageDetailsFromDrafts(organizer.drafts));
  }

  function moveMedia(id: string, direction: -1 | 1) {
    const mediaIndex = mediaItems.findIndex((item) => item.id === id);
    const targetMedia = mediaItems[mediaIndex + direction];
    if (mediaIndex < 0 || !targetMedia) return;
    const sourceIndex = items.findIndex((item) => item.id === id);
    const targetIndex = items.findIndex((item) => item.id === targetMedia.id);
    for (let step = 0; step < Math.abs(targetIndex - sourceIndex); step += 1) onMove(id, direction);
  }

  return (
    <div
      className="grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] outline-none"
      data-slot="import-review-workspace"
      data-batch-mode={organizer.batchMode ? 'true' : 'false'}
      tabIndex={-1}
      onKeyDown={submitDefault}
    >
      <header className="flex min-w-0 flex-col justify-center border-b px-4 py-4 pr-16 sm:px-8">
        <h1 className="text-xl font-semibold tracking-tight">{labels.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{labels.summary(items.length, kind)}</p>
      </header>

      <div className="flex min-h-0 min-w-0 flex-col bg-overlay">
        <input
          ref={inputRef}
          type="file"
          accept={intakeMediaAccept}
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            onAddFiles([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = '';
          }}
        />
        {mediaItems.length > 0 ? (
          <ImportBatchTable
            items={mediaItems}
            drafts={organizer.drafts}
            series={series}
            selectedIds={organizer.selectedIds}
            busy={disabled}
            relationshipsEnabled
            onToggle={organizer.toggle}
            onToggleAll={organizer.selectAll}
            onUpdateRow={organizer.updateRow}
            onUpdateAll={organizer.updateAll}
            onMove={moveMedia}
            onEditDetails={organizer.openDetails}
            onEditSelected={() => organizer.enterBatch()}
            onRemove={onRemove}
            onAddContent={() => inputRef.current?.click()}
          />
        ) : (
          <div className="flex min-h-14 shrink-0 items-center justify-end border-b bg-surface-sunken/60 px-4">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              <PlusIcon className="size-3.5" />
              {labels.addContent}
            </Button>
          </div>
        )}

        {textItems.length > 0 && (
          <section className={mediaItems.length ? 'max-h-48 shrink-0 border-t' : 'min-h-0 flex-1'}>
            <div className="h-full overflow-y-auto p-4">
              {textItems.map((item) => (
                <div key={item.id} className="flex min-w-0 items-start gap-3 rounded-lg border bg-surface p-3">
                  <FileTextIcon className="mt-2 size-4 shrink-0 text-muted-foreground" />
                  <Textarea
                    className="min-h-20 flex-1 resize-y"
                    value={item.text}
                    disabled={disabled}
                    aria-label={labels.text}
                    onChange={(event) => onEditText(item.id, event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    title={messages.intake.draft.remove}
                    aria-label={messages.intake.draft.remove}
                    onClick={() => onRemove(item.id)}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="flex min-w-0 flex-wrap items-center gap-3 border-t bg-overlay px-4 py-3 sm:px-8">
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Checkbox
            checked={favorite}
            disabled={disabled}
            onCheckedChange={(checked) => onFavoriteChange(checked === true)}
          />
          {labels.favorite}
        </label>
        <div
          className="order-last min-w-0 basis-full text-xs text-destructive sm:order-none sm:flex-1 sm:text-right"
          role="alert"
        >
          {error || (skippedCount > 0 ? labels.skipped(skippedCount) : '')}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !canImportCreation || !allNamesValid}
          onClick={() => onImportAsCreation(imageDetailsFromDrafts(organizer.drafts))}
        >
          {importingCreation && <LoaderCircleIcon className="size-4 animate-spin" />}
          {labels.importAsCreation}
        </Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={onCancel}>
          {labels.cancel}
        </Button>
        <Button
          type="button"
          disabled={disabled || !allNamesValid || items.length === 0}
          onClick={() => onImport(imageDetailsFromDrafts(organizer.drafts))}
        >
          {importingMaterial && <LoaderCircleIcon className="size-4 animate-spin" />}
          {labels.importItems(items.length)}
        </Button>
      </footer>

      <ImportMetadataDetailsDialog
        open={organizer.detailsOpen}
        title={organizer.editingItem?.name ?? labels.batchTitle(organizer.selectedItems.length)}
        draft={organizer.editorDraft}
        series={series}
        batchMode={organizer.batchMode}
        batchCount={organizer.selectedItems.length}
        batchFields={organizer.batchFields}
        relationshipEnabled={relationshipEnabled}
        disabled={disabled}
        onOpenChange={(open) => !open && organizer.closeDetails()}
        onChange={(draft) => {
          if (organizer.batchMode) organizer.setBatchDraft(draft);
          else if (organizer.editingItem) organizer.updateRow(organizer.editingItem.id, draft);
        }}
        onBatchFieldChange={(field, enabled) =>
          organizer.setBatchFields((current) => {
            const next = new Set(current);
            if (enabled) next.add(field);
            else next.delete(field);
            return next;
          })
        }
        onEnterBatch={() => organizer.enterBatch()}
        onExitBatch={organizer.exitBatch}
        onApplyBatch={() => organizer.applyBatch(relationshipEnabled)}
      />
    </div>
  );
}
