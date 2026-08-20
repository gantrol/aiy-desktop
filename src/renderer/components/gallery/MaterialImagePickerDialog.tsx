import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import type { AssetDto, FacetDefinitionDto, TermListItem } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
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
import { cn } from '@/renderer/lib/utils';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';

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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  if (!images.length) return null;
  return (
    <div className="shrink-0 border-b bg-muted/20 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{labels.selectedOrder}</span>
        <div className="flex items-center gap-2">
          <span>{labels.dragToReorder}</span>
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
            draggable
            data-dragging={draggingId === image.id ? 'true' : undefined}
            className="relative aspect-[4/3] h-16 shrink-0 cursor-grab overflow-hidden rounded-md border bg-surface opacity-100 outline-none active:cursor-grabbing data-[dragging=true]:opacity-50"
            title={labels.dragToReorder}
            onDragStart={(event) => {
              setDraggingId(image.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', image.id);
            }}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => {
              const sourceId = draggingId ?? event.dataTransfer.getData('text/plain');
              if (!sourceId || sourceId === image.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
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
            }}
          >
            <img src={image.mediaUrl} alt="" className="size-full object-cover" draggable={false} />
            <span className="absolute left-1 top-1 grid size-5 place-items-center rounded bg-overlay/90 text-[10px] font-semibold tabular-nums text-foreground shadow-sm">
              {index + 1}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute right-1 top-1 z-10 size-6 bg-overlay/90 shadow-sm"
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

function MaterialImagePickerCandidate({
  asset,
  index,
  selectedIndex,
  disabled,
  chooseLabel,
  onToggle,
}: {
  asset: AssetDto;
  index: number;
  selectedIndex: number;
  disabled: boolean;
  chooseLabel: string;
  onToggle(assetId: string): void;
}) {
  const selected = selectedIndex >= 0;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${chooseLabel}: ${index + 1} · ${asset.width}×${asset.height}`}
      aria-pressed={selected}
      className={cn(
        'relative isolate aspect-[4/3] overflow-hidden rounded-lg border-2 border-transparent bg-surface-sunken outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'border-selected-border ring-2 ring-ring',
      )}
      onClick={() => onToggle(asset.id)}
    >
      <ImageAmbientBackdrop src={asset.mediaUrl} loading="lazy" />
      <img
        src={asset.mediaUrl}
        width={asset.width}
        height={asset.height}
        className="relative z-10 size-full object-contain"
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      {selected && (
        <span className="absolute right-2 top-2 z-20 grid size-6 place-items-center rounded-md border border-selected-border bg-selected text-xs font-semibold tabular-nums text-selected-foreground shadow-sm">
          {selectedIndex + 1}
        </span>
      )}
    </button>
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
    <DialogFooter className="items-center border-t px-5 py-4 sm:justify-between">
      <span className="text-xs text-muted-foreground">{selectedLabel(selectedCount)}</span>
      <div className="flex gap-2">
        {secondaryActionLabel && onSecondaryAction && (
          <Button type="button" variant="outline" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" disabled={applyDisabled} onClick={onApply}>
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
  secondaryAction?: { label: string; onSelect(): void };
  diagnostics?: MaterialImagePickerDiagnosticSink;
  beginDiagnostics?(details?: MaterialImagePickerDiagnosticDetails): void | (() => void);
  createImage(asset: AssetDto): T;
  onOpenChange(open: boolean): void;
  onCollectionChange(collection: MaterialImagePickerCollection): void;
  onApply(images: T[]): void;
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
  const materialState = useMaterialImagePickerMaterials({
    active: open,
    libraryKey,
    dataRevision,
    collection,
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
      orderCustomizedRef.current = selectedImages.length > 0;
    }
    wasOpenRef.current = open;
  }, [open, selectedImages]);

  useLayoutEffect(() => {
    if (open) materialViewportRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [collectionKey, open]);

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
      const asset = materialState.images.find((image) => image.asset.id === assetId)?.asset;
      if (!asset) return current;
      const image = createImage(asset);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-dialog={dialogName} className="max-h-[90vh] max-w-6xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="flex h-[min(70vh,42rem)] min-h-0 overflow-hidden">
          <MaterialLibraryNavigation
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
            onDelete={ignoreMaterialMutation}
            onCollectMaterials={ignoreMaterialMutation}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            {albumState.failed && (
              <p className="border-b px-4 py-2 text-xs text-destructive">{labels.albumsLoadFailed}</p>
            )}
            {materialPending && (
              <p className="border-b px-4 py-2 text-xs text-muted-foreground">{labels.loadingMaterials}</p>
            )}
            {materialState.failed && (
              <p className="border-b px-4 py-2 text-xs text-destructive">{labels.materialsLoadFailed}</p>
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
            <ScrollArea
              aria-busy={materialState.loading}
              data-stale={materialState.stale ? 'true' : undefined}
              className="min-h-0 flex-1"
              viewportRef={materialViewportRef}
            >
              <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4">
                {materialPending &&
                  materialState.images.length === 0 &&
                  Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className="aspect-[4/3] animate-none rounded-lg" />
                  ))}
                {materialState.images.map(({ asset }, index) => (
                  <MaterialImagePickerCandidate
                    key={asset.id}
                    asset={asset}
                    index={index}
                    selectedIndex={draftImages.findIndex((image) => image.id === asset.id)}
                    disabled={materialState.stale}
                    chooseLabel={labels.choose}
                    onToggle={toggle}
                  />
                ))}
                {materialState.loaded &&
                  !materialState.loading &&
                  !materialState.failed &&
                  materialState.images.length === 0 && (
                    <div className="col-span-full grid h-48 place-items-center text-sm text-muted-foreground">
                      {labels.noImages}
                    </div>
                  )}
                {materialState.nextCursor && (
                  <div className="col-span-full flex justify-center py-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={materialState.stale || materialState.loadingMore}
                      onClick={() => void materialState.loadMore()}
                    >
                      {materialState.loadingMore
                        ? messages.gallery.screen.loadingMore
                        : messages.gallery.screen.loadMore}
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>
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
      </DialogContent>
    </Dialog>
  );
}
