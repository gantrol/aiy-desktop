import { ImagePlusIcon, LoaderCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AlbumDto, CreatorImageImportSource, ImportedImageMetadataInput } from '@/shared/contracts';
import { buildAlbumTreeIndex, flattenAlbumTree } from '@/renderer/components/albums/albumTree';
import { imageMimeType, type RendererImageImportSource } from '@/renderer/components/creator/imageImport';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { ImportBatchTable } from '@/renderer/features/intake/ImportBatchTable';
import { ImportMetadataDetailsDialog } from '@/renderer/features/intake/ImportMetadataDetailsDialog';
import { imageMetadataFromDraft, type IntakeImageMetadataDraft } from '@/renderer/features/intake/importMetadata';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';
import { useImportMetadataOrganizer } from '@/renderer/features/intake/useImportMetadataOrganizer';
import { useI18n } from '@/renderer/i18n/useI18n';

type PendingImage = Extract<LocalIntakeItem, { kind: 'IMAGE' }>;

export interface NewExternalCreationDialogValue {
  title: string;
  promptKnowledge: 'EXACT' | 'UNKNOWN';
  prompt: string;
  sourceUrl: string;
  source: CreatorImageImportSource;
  outputs: Array<{ file: File; metadata: ImportedImageMetadataInput }>;
  albumId: string | null;
}

interface Props {
  open: boolean;
  albums: AlbumDto[];
  defaultAlbumId?: string | null;
  initialFiles?: File[];
  initialSource?: RendererImageImportSource;
  initialSourceUrl?: string;
  onOpenChange(open: boolean): void;
  onCreate(value: NewExternalCreationDialogValue): Promise<void>;
}

const maxImages = 8;

function fileIdentity(file: File) {
  return `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
}

function externalOutputMetadata(draft: IntakeImageMetadataDraft, exactPrompt: string | null) {
  const metadata = imageMetadataFromDraft(draft);
  return exactPrompt !== null && !metadata.generationText.trim()
    ? { ...metadata, generationTextType: 'EXACT_PROMPT' as const, generationText: exactPrompt }
    : metadata;
}

type ExternalCreationImportLabels = ReturnType<typeof useI18n>['messages']['creator']['externalCreationImport'];
type AlbumRow = ReturnType<typeof flattenAlbumTree>[number];

function ExternalCreationFields({
  labels,
  title,
  promptKnowledge,
  prompt,
  sourceUrl,
  albumId,
  albumRows,
  disabled,
  onTitleChange,
  onPromptKnowledgeChange,
  onPromptChange,
  onSourceUrlChange,
  onAlbumChange,
}: {
  labels: ExternalCreationImportLabels;
  title: string;
  promptKnowledge: 'EXACT' | 'UNKNOWN';
  prompt: string;
  sourceUrl: string;
  albumId: string;
  albumRows: AlbumRow[];
  disabled: boolean;
  onTitleChange(value: string): void;
  onPromptKnowledgeChange(value: 'EXACT' | 'UNKNOWN'): void;
  onPromptChange(value: string): void;
  onSourceUrlChange(value: string): void;
  onAlbumChange(value: string): void;
}) {
  return (
    <div className="grid max-h-72 gap-3 overflow-y-auto border-b p-4 lg:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-medium">
        {labels.creationTitle}
        <Input
          autoFocus
          value={title}
          maxLength={300}
          disabled={disabled}
          placeholder={labels.optional}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <div className="grid gap-1.5 text-sm font-medium">
        <span>{labels.promptKnowledge}</span>
        <Segmented
          type="single"
          value={promptKnowledge}
          onValueChange={(value) => value && onPromptKnowledgeChange(value as 'EXACT' | 'UNKNOWN')}
        >
          <SegmentedItem value="EXACT">{labels.exactPrompt}</SegmentedItem>
          <SegmentedItem value="UNKNOWN">{labels.unknownPrompt}</SegmentedItem>
        </Segmented>
      </div>
      {promptKnowledge === 'EXACT' && (
        <label className="grid gap-1.5 text-sm font-medium lg:col-span-2">
          {labels.promptKnowledge}
          <Textarea
            value={prompt}
            rows={4}
            maxLength={30_000}
            disabled={disabled}
            className="resize-y"
            onChange={(event) => onPromptChange(event.target.value)}
          />
        </label>
      )}
      <label className="grid gap-1.5 text-sm font-medium">
        {labels.sourceUrl}
        <Input
          type="url"
          value={sourceUrl}
          maxLength={2048}
          disabled={disabled}
          placeholder={labels.optional}
          onChange={(event) => onSourceUrlChange(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        {labels.album}
        <Select value={albumId || '__none__'} disabled={disabled} onValueChange={onAlbumChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{labels.noAlbum}</SelectItem>
            {albumRows.map(({ album, depth }) => (
              <SelectItem key={album.id} value={album.id}>{`${'　'.repeat(depth)}${album.title}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function ExternalCreationMetadataDetails({
  organizer,
  batchTitle,
  disabled,
}: {
  organizer: ReturnType<typeof useImportMetadataOrganizer>;
  batchTitle: string;
  disabled: boolean;
}) {
  return (
    <ImportMetadataDetailsDialog
      open={organizer.detailsOpen}
      title={organizer.editingItem?.name ?? batchTitle}
      draft={organizer.editorDraft}
      series={[]}
      batchMode={organizer.batchMode}
      batchCount={organizer.selectedItems.length}
      batchFields={organizer.batchFields}
      relationshipEnabled={false}
      disabled={disabled}
      onOpenChange={(next) => !next && organizer.closeDetails()}
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
      onApplyBatch={() => organizer.applyBatch(false)}
    />
  );
}

export function NewExternalCreationDialog({
  open,
  albums,
  defaultAlbumId = null,
  initialFiles = [],
  initialSource = 'UPLOAD',
  initialSourceUrl = '',
  onOpenChange,
  onCreate,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.externalCreationImport;
  const [title, setTitle] = useState('');
  const [promptKnowledge, setPromptKnowledge] = useState<'EXACT' | 'UNKNOWN'>('UNKNOWN');
  const [prompt, setPrompt] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [source, setSource] = useState<CreatorImageImportSource>('UPLOAD');
  const [albumId, setAlbumId] = useState(defaultAlbumId ?? '');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef(images);
  const seededOpenRef = useRef(false);
  const organizer = useImportMetadataOrganizer(images);
  imagesRef.current = images;
  const albumRows = useMemo(() => flattenAlbumTree(buildAlbumTreeIndex(albums)), [albums]);

  useEffect(
    () => () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const selectableAlbumIds = new Set(albumRows.map((row) => row.album.id));
    setAlbumId(defaultAlbumId && selectableAlbumIds.has(defaultAlbumId) ? defaultAlbumId : '');
  }, [albumRows, defaultAlbumId, open]);

  function clear() {
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    setImages([]);
    organizer.reset();
    setTitle('');
    setPromptKnowledge('UNKNOWN');
    setPrompt('');
    setSourceUrl('');
    setSource('UPLOAD');
    setError('');
  }

  function changeOpen(next: boolean) {
    if (submitting) return;
    if (!next) clear();
    onOpenChange(next);
  }

  const addImages = useCallback(
    (files: readonly File[], nextSource: RendererImageImportSource, nextSourceUrl = '') => {
      const existing = new Set(images.map((image) => fileIdentity(image.file)));
      const next = [...images];
      let rejection: 'TYPE' | 'SIZE' | 'LIMIT' | 'DUPLICATE' | null = null;
      for (const file of files) {
        const mimeType = imageMimeType(file);
        if (!mimeType) {
          rejection ??= 'TYPE';
          continue;
        }
        if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
          rejection ??= 'SIZE';
          continue;
        }
        if (next.length >= maxImages) {
          rejection ??= 'LIMIT';
          continue;
        }
        if (existing.has(fileIdentity(file))) {
          rejection ??= 'DUPLICATE';
          continue;
        }
        existing.add(fileIdentity(file));
        next.push({
          id: crypto.randomUUID(),
          kind: 'IMAGE',
          name: file.name || labels.imageFallback,
          mimeType,
          file,
          previewUrl: URL.createObjectURL(file),
          sourceUrl: nextSourceUrl,
        });
      }
      if (next.length > images.length && images.length === 0) setSource(nextSource);
      if (next.length > images.length && nextSourceUrl) setSourceUrl((current) => current || nextSourceUrl);
      setImages(next);
      setError(rejection ? labels.errors[rejection] : '');
    },
    [images, labels.errors, labels.imageFallback],
  );

  useEffect(() => {
    if (!open) {
      seededOpenRef.current = false;
      return;
    }
    if (seededOpenRef.current) return;
    seededOpenRef.current = true;
    if (initialFiles.length) addImages(initialFiles, initialSource, initialSourceUrl);
  }, [addImages, initialFiles, initialSource, initialSourceUrl, open]);

  function removeImage(id: string) {
    setImages((current) =>
      current.filter((image) => {
        if (image.id !== id) return true;
        URL.revokeObjectURL(image.previewUrl);
        return false;
      }),
    );
  }

  function moveImage(id: string, direction: -1 | 1) {
    setImages((current) => {
      const index = current.findIndex((image) => image.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exactPrompt = prompt.trim();
    const rows = images.flatMap((image) => {
      const draft = organizer.drafts[image.id];
      return draft
        ? [
            {
              file: image.file,
              metadata: externalOutputMetadata(draft, promptKnowledge === 'EXACT' ? exactPrompt : null),
            },
          ]
        : [];
    });
    const valid =
      rows.length === images.length &&
      rows.length > 0 &&
      rows.every((row) => Boolean(row.metadata.displayName.trim())) &&
      (promptKnowledge === 'UNKNOWN' || Boolean(exactPrompt));
    if (!valid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onCreate({
        title: title.trim(),
        promptKnowledge,
        prompt: exactPrompt,
        sourceUrl: sourceUrl.trim(),
        source,
        outputs: rows,
        albumId: albumId || null,
      });
      clear();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  const allNamesValid = images.every((image) => Boolean(organizer.drafts[image.id]?.displayName.trim()));
  const valid = images.length > 0 && allNamesValid && (promptKnowledge === 'UNKNOWN' || Boolean(prompt.trim()));

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[min(96vw,86rem)] gap-0 overflow-hidden p-0">
        <PasteDropSurface
          disabled={submitting}
          className="min-h-0"
          overlay={<ImagePlusIcon className="size-8 text-muted-foreground" />}
          onImages={addImages}
        >
          <form
            className="grid max-h-[calc(100vh-2rem)] min-h-[38rem] grid-rows-[auto_auto_minmax(0,1fr)_auto]"
            onSubmit={(event) => void submit(event)}
          >
            <DialogHeader className="border-b px-5 py-4 pr-14">
              <DialogTitle>{labels.title}</DialogTitle>
              <DialogDescription className="sr-only">{labels.description}</DialogDescription>
            </DialogHeader>

            <ExternalCreationFields
              labels={labels}
              title={title}
              promptKnowledge={promptKnowledge}
              prompt={prompt}
              sourceUrl={sourceUrl}
              albumId={albumId}
              albumRows={albumRows}
              disabled={submitting}
              onTitleChange={setTitle}
              onPromptKnowledgeChange={setPromptKnowledge}
              onPromptChange={setPrompt}
              onSourceUrlChange={setSourceUrl}
              onAlbumChange={(value) => setAlbumId(value === '__none__' ? '' : value)}
            />

            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                addImages([...(event.currentTarget.files ?? [])], 'UPLOAD');
                event.currentTarget.value = '';
              }}
            />
            <ImportBatchTable
              items={images}
              drafts={organizer.drafts}
              series={[]}
              selectedIds={organizer.selectedIds}
              busy={submitting}
              relationshipsEnabled={false}
              fallbackPrompt={promptKnowledge === 'EXACT' ? prompt : ''}
              onToggle={organizer.toggle}
              onToggleAll={organizer.selectAll}
              onUpdateRow={organizer.updateRow}
              onUpdateAll={organizer.updateAll}
              onMove={moveImage}
              onEditDetails={organizer.openDetails}
              onEditSelected={() => organizer.enterBatch()}
              onRemove={removeImage}
              onAddContent={() => inputRef.current?.click()}
            />

            <DialogFooter className="items-center border-t px-5 py-3">
              <div className="mr-auto min-w-0 text-sm text-destructive" role="alert">
                {error}
              </div>
              <Button type="button" variant="outline" disabled={submitting} onClick={() => changeOpen(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={submitting || !valid}>
                {submitting && <LoaderCircleIcon className="size-4 animate-spin" />}
                {labels.createV01}
              </Button>
            </DialogFooter>
          </form>
        </PasteDropSurface>

        <ExternalCreationMetadataDetails
          organizer={organizer}
          batchTitle={messages.intake.review.batchTitle(organizer.selectedItems.length)}
          disabled={submitting}
        />
      </DialogContent>
    </Dialog>
  );
}
