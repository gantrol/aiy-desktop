import { itemReorderHandler } from '@/renderer/components/albums/itemDrag';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import type { AssetDto, FacetDefinitionDto, GalleryItemDto, TermListItem } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { useWorkspacePaneContainer } from '@/renderer/components/workspace/WorkspacePaneScope';
import { MaterialImagePickerResults } from '@/renderer/components/gallery/MaterialImagePickerResults';
import {
  MaterialImagePickerToolbar,
  materialImagePickerScope,
} from '@/renderer/components/gallery/MaterialImagePickerToolbar';
import { buildDictionaryMaterialTree } from '@/renderer/components/gallery/dictionaryMaterialTree';
import { MaterialLibraryNavigation } from '@/renderer/components/gallery/MaterialLibraryNavigation';
import type {
  MaterialImagePickerCollection,
  MaterialImagePickerDiagnosticDetails,
  MaterialImagePickerDiagnosticSink,
  MaterialImagePickerImage,
} from '@/renderer/components/gallery/materialImagePicker';
import {
  materialImagePickerCollectionDepth,
  reorderMaterialImagePickerImages,
} from '@/renderer/components/gallery/materialImagePicker';
import {
  useMaterialImagePickerAlbums,
  useMaterialImagePickerMaterials,
} from '@/renderer/components/gallery/useMaterialImagePickerData';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { cn } from '@/renderer/lib/utils';

const ignoreMaterialMutation = () => Promise.resolve();

export interface MaterialImagePickerLabels {
  title: string;
  choose: string;
  apply: string;
  noImages: string;
  selected(count: number): string;
  selectedOrder: string;
  dragToReorder: string;
  deselectAll: string;
  deselectImage(index: number): string;
  albumsLoadFailed: string;
  loadingMaterials: string;
  materialsLoadFailed: string;
}

function MaterialImagePickerSelectionStrip<T extends MaterialImagePickerImage>({
  images,
  labels,
  onClear,
  onRemove,
  onReorder,
}: {
  images: readonly T[];
  labels: MaterialImagePickerLabels;
  onClear(): void;
  onRemove(imageId: string): void;
  onReorder(images: T[]): void;
}) {
  const copy = useI18n().messages.gallery.imagePicker;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  if (!images.length) return null;
  return (
    <div className="shrink-0 border-b bg-muted/20 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{labels.selectedOrder}</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="2xs" onClick={onClear}>
            {labels.deselectAll}
          </Button>
        </div>
      </div>
      <div role="list" aria-label={labels.selectedOrder} className="flex gap-2 overflow-x-auto pb-1">
        {images.map((image, index) => (
          <div
            key={image.id}
            role="listitem"
            tabIndex={0}
            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
            draggable
            data-dragging={draggingId === image.id ? 'true' : undefined}
            className="relative aspect-[4/3] h-12 shrink-0 cursor-grab overflow-hidden rounded-sm border border-selected-border bg-surface opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing data-[dragging=true]:opacity-50"
            title={copy.reorder}
            aria-label={`${labels.selectedOrder}: ${index + 1}. ${copy.reorder}`}
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                !event.altKey ||
                !['ArrowLeft', 'ArrowRight'].includes(event.key)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              const after = event.key === 'ArrowRight';
              const target = images[index + (after ? 1 : -1)];
              if (target) onReorder(reorderMaterialImagePickerImages(images, image.id, target.id, after));
            }}
            onDragStart={(event) => {
              setDraggingId(image.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', image.id);
            }}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={itemReorderHandler((event) => {
              const sourceId = draggingId ?? event.dataTransfer.getData('text/plain');
              if (!sourceId || sourceId === image.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            })}
            onDrop={itemReorderHandler((event) => {
              event.preventDefault();
              const sourceId = draggingId ?? event.dataTransfer.getData('text/plain');
              const bounds = event.currentTarget.getBoundingClientRect();
              if (sourceId && sourceId !== image.id) {
                onReorder(
                  reorderMaterialImagePickerImages(
                    images,
                    sourceId,
                    image.id,
                    event.clientX >= bounds.left + bounds.width / 2,
                  ),
                );
              }
              setDraggingId(null);
            })}
          >
            <AssetThumbnail
              asset={image}
              size={192}
              alt=""
              className="size-full bg-media-surround-light object-contain"
              draggable={false}
            />
            <span className="absolute left-1 top-1 grid size-5 place-items-center rounded bg-overlay/90 text-[10px] font-semibold tabular-nums text-foreground">
              {index + 1}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute right-1 top-1 z-10 size-6 bg-overlay/90"
              aria-label={labels.deselectImage(index + 1)}
              title={labels.deselectImage(index + 1)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onRemove(image.id)}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MaterialImagePickerFooter({
  selectedCount,
  selectedLabel,
  cancelLabel,
  applyLabel,
  applyDisabled,
  secondaryActionLabel,
  onCancel,
  onApply,
  onSecondaryAction,
}: {
  selectedCount: number;
  selectedLabel(count: number): string;
  cancelLabel: string;
  applyLabel: string;
  applyDisabled: boolean;
  secondaryActionLabel?: string;
  onCancel(): void;
  onApply(): void;
  onSecondaryAction?(): void;
}) {
  return (
    <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between border-t px-3 py-2 sm:justify-between">
      <span className="text-xs text-muted-foreground">{selectedLabel(selectedCount)}</span>
      <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
        {secondaryActionLabel && onSecondaryAction && (
          <Button type="button" variant="outline" size="sm" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" size="sm" disabled={applyDisabled} onClick={onApply}>
          {applyLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}

function pickerNavigationLabels(messages: ReturnType<typeof useI18n>['messages']) {
  const albums = messages.gallery.albums;
  const navigation = albums.navigation;
  return {
    creation: navigation.creation,
    dictionary: navigation.dictionary,
    material: navigation.material,
    allMaterials: albums.allMaterials,
    albums: navigation.albums,
    create: albums.create,
    createTitle: albums.createTitle,
    createChild: albums.createChild,
    open: albums.open,
    rename: albums.rename,
    renameTitle: albums.renameTitle,
    archive: albums.archive,
    delete: albums.delete,
    deleteTitle: albums.deleteTitle,
    deleteDescription: (title: string) => `${albums.deleteDescription} · ${title}`,
    expand: albums.expand,
    collapse: albums.collapse,
    move: albums.move,
    moveTitle: albums.moveTitle,
    moveToRoot: albums.moveToRoot,
    more: messages.gallery.screen.loadMore,
    moreActions: (title: string) => `${albums.moreActions}: ${title}`,
    name: albums.name,
    namePlaceholder: albums.namePlaceholder,
    cancel: albums.cancel,
    save: albums.save,
    confirmDelete: albums.confirmDelete,
    operationFailed: albums.operationFailed,
  };
}

function useMaterialImagePickerDiagnostics({
  open,
  collectionKey,
  collection,
  facetCount,
  selectedImageCount,
  termCount,
  materialView,
  diagnostics,
  beginDiagnostics,
}: {
  open: boolean;
  collectionKey: string;
  collection: MaterialImagePickerCollection;
  facetCount: number;
  selectedImageCount: number;
  termCount: number;
  materialView: { failed: boolean; imageCount: number; loaded: boolean; loading: boolean; stale: boolean };
  diagnostics?: MaterialImagePickerDiagnosticSink;
  beginDiagnostics?(details?: MaterialImagePickerDiagnosticDetails): void | (() => void);
}) {
  const openDetailsRef = useRef<MaterialImagePickerDiagnosticDetails>({});
  openDetailsRef.current = { facetCount, selectedImageCount, termCount };
  const collectionDetailsRef = useRef<MaterialImagePickerDiagnosticDetails>({});
  collectionDetailsRef.current = {
    collectionDepth: materialImagePickerCollectionDepth(collection),
    collectionKind: collection.kind,
  };
  const materialViewDetailsRef = useRef<MaterialImagePickerDiagnosticDetails>({});
  materialViewDetailsRef.current = materialView;

  useLayoutEffect(() => {
    if (!open || !beginDiagnostics) return;
    return beginDiagnostics(openDetailsRef.current);
  }, [beginDiagnostics, open]);

  useLayoutEffect(() => {
    if (open) diagnostics?.('picker.collection.committed', collectionDetailsRef.current);
  }, [collectionKey, diagnostics, open]);

  useLayoutEffect(() => {
    if (open) diagnostics?.('materials.view.committed', materialViewDetailsRef.current);
  }, [
    diagnostics,
    materialView.failed,
    materialView.imageCount,
    materialView.loaded,
    materialView.loading,
    materialView.stale,
    open,
  ]);
}

interface MaterialImagePickerDialogProps<T extends MaterialImagePickerImage> {
  open: boolean;
  dialogName?: string;
  libraryKey: string;
  dataRevision: number;
  terms: readonly TermListItem[];
  facets: readonly FacetDefinitionDto[];
  collection: MaterialImagePickerCollection;
  selectedImages: readonly T[];
  labels: MaterialImagePickerLabels;
  maxSelected: number;
  includeVideos?: boolean;
  selectionDisabledReason?(item: GalleryItemDto, selected: readonly T[]): string | undefined;
  secondaryAction?: { label: string; onSelect(): void };
  diagnostics?: MaterialImagePickerDiagnosticSink;
  beginDiagnostics?(details?: MaterialImagePickerDiagnosticDetails): void | (() => void);
  createImage(asset: AssetDto, item: GalleryItemDto): T;
  onOpenChange(open: boolean): void;
  onCollectionChange(collection: MaterialImagePickerCollection): void;
  onApply(images: T[]): void;
}

function MaterialImagePickerHeader({
  title,
  onToggleHostChange,
}: {
  title: string;
  onToggleHostChange(host: HTMLDivElement | null): void;
}) {
  const { messages } = useI18n();
  return (
    <DialogHeader className="shrink-0 flex-row items-center gap-2 border-b px-3 py-2">
      <div ref={onToggleHostChange} className="flex shrink-0" />
      <DialogTitle className="min-w-0 flex-1 truncate text-sm">{title}</DialogTitle>
      <DialogClose asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={messages.common.close}>
          <XIcon aria-hidden="true" className="size-4" />
        </Button>
      </DialogClose>
    </DialogHeader>
  );
}

function MaterialImagePickerSurface({
  open,
  dialogName,
  title,
  onOpenChange,
  onToggleHostChange,
  children,
}: {
  open: boolean;
  dialogName: string;
  title: string;
  onOpenChange(open: boolean): void;
  onToggleHostChange(host: HTMLDivElement | null): void;
  children: ReactNode;
}) {
  const paneContainer = useWorkspacePaneContainer();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog container={paneContainer} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-dialog={dialogName}
        aria-describedby={undefined}
        showCloseButton={false}
        className={cn(
          'flex h-[min(88dvh,52rem)] max-h-[calc(100dvh-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-md p-0',
          paneContainer &&
            'h-full max-h-full w-full rounded-none border-0 shadow-none @min-[40rem]/workspace-pane:h-[calc(100%-1.5rem)] @min-[40rem]/workspace-pane:w-[calc(100%-1.5rem)] @min-[40rem]/workspace-pane:rounded-md @min-[40rem]/workspace-pane:border',
        )}
        onOpenAutoFocus={(event) => {
          returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          if (event.target instanceof HTMLElement)
            event.target.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
        }}
      >
        <MaterialImagePickerHeader title={title} onToggleHostChange={onToggleHostChange} />
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function MaterialImagePickerDialog<T extends MaterialImagePickerImage>({
  open,
  dialogName = 'material-image-picker',
  libraryKey,
  dataRevision,
  terms,
  facets,
  collection,
  selectedImages,
  labels,
  maxSelected,
  includeVideos = false,
  selectionDisabledReason,
  secondaryAction,
  diagnostics,
  beginDiagnostics,
  createImage,
  onOpenChange,
  onCollectionChange,
  onApply,
}: MaterialImagePickerDialogProps<T>) {
  const { locale, messages } = useI18n();
  const wasOpenRef = useRef(false);
  const orderCustomizedRef = useRef(false);
  const materialViewportRef = useRef<HTMLDivElement>(null);
  const collectionKey = JSON.stringify(collection);
  const [draftImages, setDraftImages] = useState<T[]>(() => [...selectedImages]);
  const [query, setQuery] = useState('');
  const [navigationToggleHost, setNavigationToggleHost] = useState<HTMLDivElement | null>(null);
  const materialState = useMaterialImagePickerMaterials({
    active: open,
    libraryKey,
    dataRevision,
    collection,
    query,
    includeVideos,
    diagnostics,
  });
  const albumState = useMaterialImagePickerAlbums({
    active: open,
    libraryKey,
    dataRevision,
    diagnostics,
  });
  const dictionaryTree = useMemo(
    () => buildDictionaryMaterialTree(terms, facets, messages.dictionary.wordPalette.uncategorized, locale),
    [facets, locale, messages.dictionary.wordPalette.uncategorized, terms],
  );
  const navigationLabels = pickerNavigationLabels(messages);
  const materialPending =
    open && (!materialState.loaded || (materialState.loading && materialState.images.length === 0));
  const albumsPending = open && (!albumState.loaded || (albumState.loading && albumState.albums.length === 0));
  useMaterialImagePickerDiagnostics({
    open,
    collectionKey,
    collection,
    facetCount: facets.length,
    selectedImageCount: selectedImages.length,
    termCount: terms.length,
    materialView: {
      failed: materialState.failed,
      imageCount: materialState.images.length,
      loaded: materialState.loaded,
      loading: materialState.loading,
      stale: materialState.stale,
    },
    diagnostics,
    beginDiagnostics,
  });

  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      setDraftImages([...selectedImages]);
      setQuery('');
      orderCustomizedRef.current = selectedImages.length > 0;
    }
    wasOpenRef.current = open;
  }, [open, selectedImages]);

  useLayoutEffect(() => {
    if (open) materialViewportRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [collectionKey, open, query]);

  useEffect(() => {
    if (
      !open ||
      collection.kind !== 'album' ||
      albumState.stale ||
      !albumState.loaded ||
      albumState.loading ||
      albumState.failed ||
      albumState.albums.some((album) => album.id === collection.albumId)
    ) {
      return;
    }
    onCollectionChange({ kind: 'all' });
  }, [
    albumState.albums,
    albumState.failed,
    albumState.loaded,
    albumState.loading,
    albumState.stale,
    collection,
    onCollectionChange,
    open,
  ]);

  function toggle(assetId: string) {
    setDraftImages((current) => {
      if (current.some((image) => image.id === assetId)) {
        const next = current.filter((image) => image.id !== assetId);
        if (!next.length) orderCustomizedRef.current = false;
        return next;
      }
      if (current.length >= maxSelected) return current;
      const selected = new Map(current.map((image) => [image.id, image]));
      const candidate = materialState.images.find((image) => image.asset.id === assetId);
      if (!candidate || selectionDisabledReason?.(candidate.item, current)) return current;
      const { asset, item } = candidate;
      const image = createImage(asset, item);
      if (orderCustomizedRef.current) return [...current, image];
      selected.set(asset.id, image);
      const currentCollectionIds = new Set(materialState.images.map((image) => image.asset.id));
      const outsideCollection = current.filter((image) => !currentCollectionIds.has(image.id));
      const currentCollection = materialState.images.flatMap(({ asset: candidate }) => {
        const image = selected.get(candidate.id);
        return image ? [image] : [];
      });
      return [...outsideCollection, ...currentCollection];
    });
  }

  return (
    <MaterialImagePickerSurface
      open={open}
      dialogName={dialogName}
      title={labels.title}
      onOpenChange={onOpenChange}
      onToggleHostChange={setNavigationToggleHost}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <MaterialLibraryNavigation
          toggleHost={navigationToggleHost}
          albums={albumState.albums}
          browseOnly
          category={collection.kind === 'dictionary' ? 'DICTIONARY' : 'MATERIAL'}
          activeAlbumId={collection.kind === 'album' ? collection.albumId : null}
          dictionarySelection={collection.kind === 'dictionary' ? collection : null}
          dictionaryTree={dictionaryTree}
          labels={navigationLabels}
          busy={albumsPending}
          diagnostics={diagnostics}
          onSelectCategory={(category) =>
            onCollectionChange(category === 'DICTIONARY' ? { kind: 'dictionary', scope: 'ALL' } : { kind: 'all' })
          }
          onSelectAlbum={(albumId) => onCollectionChange({ kind: 'album', albumId })}
          onSelectDictionary={(next) => onCollectionChange({ ...next, scope: 'ALL' })}
          onCreate={ignoreMaterialMutation}
          onRename={ignoreMaterialMutation}
          onArchive={ignoreMaterialMutation}
          onDelete={ignoreMaterialMutation}
          onCollectMaterials={ignoreMaterialMutation}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <MaterialImagePickerToolbar
            scope={materialImagePickerScope(collection, albumState.albums, dictionaryTree, navigationLabels)}
            onQueryChange={(next) => {
              if (next.trim() !== query.trim() && draftImages.length) orderCustomizedRef.current = true;
              setQuery(next);
            }}
          />
          {albumState.failed && (
            <p className="border-b px-4 py-2 text-xs text-destructive">{labels.albumsLoadFailed}</p>
          )}
          {materialPending && (
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">{labels.loadingMaterials}</p>
          )}
          {materialState.failed && (
            <div
              role="alert"
              className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs text-destructive"
            >
              <span>{labels.materialsLoadFailed}</span>
              <Button type="button" variant="ghost" size="xs" onClick={materialState.retry}>
                {messages.workbench.retry}
              </Button>
            </div>
          )}
          <MaterialImagePickerSelectionStrip
            images={draftImages}
            labels={labels}
            onClear={() => {
              orderCustomizedRef.current = false;
              setDraftImages([]);
            }}
            onRemove={(imageId) => {
              setDraftImages((current) => {
                const next = current.filter((image) => image.id !== imageId);
                if (!next.length) orderCustomizedRef.current = false;
                return next;
              });
            }}
            onReorder={(images) => {
              orderCustomizedRef.current = true;
              setDraftImages(images);
            }}
          />
          <MaterialImagePickerResults
            state={materialState}
            pending={materialPending}
            selectedImages={draftImages}
            maxSelected={maxSelected}
            selectionDisabledReason={(item) => selectionDisabledReason?.(item, draftImages)}
            chooseLabel={labels.choose}
            emptyLabel={query.trim() ? messages.gallery.imagePicker.noResults : labels.noImages}
            viewportRef={materialViewportRef}
            onToggle={toggle}
          />
        </div>
      </div>
      <MaterialImagePickerFooter
        selectedCount={draftImages.length}
        selectedLabel={labels.selected}
        cancelLabel={messages.common.cancel}
        applyLabel={labels.apply}
        applyDisabled={draftImages.length === 0 && selectedImages.length === 0}
        secondaryActionLabel={secondaryAction?.label}
        onCancel={() => onOpenChange(false)}
        onSecondaryAction={
          secondaryAction
            ? () => {
                onOpenChange(false);
                secondaryAction.onSelect();
              }
            : undefined
        }
        onApply={() => {
          onApply(draftImages);
          onOpenChange(false);
        }}
      />
    </MaterialImagePickerSurface>
  );
}
