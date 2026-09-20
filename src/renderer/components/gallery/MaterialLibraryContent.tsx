import { ImageIcon } from 'lucide-react';
import type { DragEvent as ReactDragEvent, RefObject } from 'react';
import type { AssetFileRevealContext, MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { QuietEmpty } from '@/renderer/components/ui/quiet-empty';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { CreationAlbumGrid } from '@/renderer/components/gallery/CreationAlbumGrid';
import { MaterialAlbumGrid } from '@/renderer/components/gallery/MaterialAlbumGrid';
import type { MaterialAlbumBrowseSummary } from '@/renderer/components/gallery/materialAlbumBrowse';
import { MaterialMasonry } from '@/renderer/components/gallery/MaterialMasonry';
import { MaterialZoneHeading } from '@/renderer/components/gallery/MaterialZoneHeading';
import { MaterialZoneMasonry } from '@/renderer/components/gallery/MaterialZoneMasonry';
import type { MaterialLibraryItem, SelectionModifiers } from '@/renderer/components/gallery/materialLibraryTypes';

interface Props {
  albums: readonly MaterialAlbumBrowseSummary[];
  creationCollections: readonly MaterialAlbumDto[] | null;
  overviewCreationCollections: readonly MaterialAlbumDto[];
  creationSectionTitle: string | null;
  albumSectionTitle: string | null;
  materialSectionTitle: string | null;
  overviewMode: boolean;
  materialTotal: number;
  materials: readonly MaterialLibraryItem[];
  selectedKey: string | null;
  checkedKeys: ReadonlySet<string>;
  selectionMode: boolean;
  selectionAvailable: boolean;
  loading: boolean;
  error: string;
  showingPreviousResults: boolean;
  searchActive: boolean;
  unratedActive: boolean;
  albumMutationBusy: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  pageEndRef: RefObject<HTMLDivElement | null>;
  onOpenAlbum(albumId: string): void;
  canMoveCreationAlbum(albumId: string, parentAlbumId: string | null): boolean;
  onMoveCreationAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  canMoveAlbum(albumId: string, parentAlbumId: string | null): boolean;
  onMoveAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  onCollectMaterials(albumId: string, targets: MaterialSelectionTargetInput[]): Promise<void>;
  onImportFiles?(album: MaterialAlbumDto, files: File[]): void;
  onArchiveAlbum(album: MaterialAlbumDto): void;
  onDeleteAlbum(album: MaterialAlbumDto): void;
  onSelect(item: MaterialLibraryItem, modifiers?: SelectionModifiers): void;
  onEnterSelection(item: MaterialLibraryItem): void;
  onToggleSelection(item: MaterialLibraryItem): void;
  onCopyText(text: string): void;
  onArchiveMaterial(item: MaterialLibraryItem): void;
  onDeleteMaterial(item: MaterialLibraryItem): void;
  notify(message: string): void;
  onDragStart?(event: ReactDragEvent<HTMLElement>, item: MaterialLibraryItem): void;
  revealContextForItem?(item: MaterialLibraryItem): AssetFileRevealContext | undefined;
  onClearSearch(): void;
  onClearUnrated(): void;
  onRetry(): void;
}

function MaterialSkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4 overflow-hidden">
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} className="aspect-[4/3] rounded-xl" />
      ))}
    </div>
  );
}

function CreationCollectionBrowser({
  albums,
  viewportRef,
  onOpen,
  busy,
  canMoveCreationAlbum,
  onMoveCreationAlbum,
}: {
  albums: readonly MaterialAlbumDto[];
  viewportRef: RefObject<HTMLDivElement | null>;
  onOpen(albumId: string): void;
  busy: boolean;
  canMoveCreationAlbum(albumId: string, parentAlbumId: string | null): boolean;
  onMoveCreationAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
}) {
  const { messages } = useI18n();
  if (!albums.length) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <strong className="text-sm font-medium">{messages.gallery.screen.empty}</strong>
      </div>
    );
  }
  return (
    <ScrollArea
      type="always"
      className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
      viewportRef={viewportRef}
    >
      <CreationAlbumGrid
        viewportRef={viewportRef}
        albums={albums}
        busy={busy}
        onOpen={onOpen}
        canMoveCreationAlbum={canMoveCreationAlbum}
        onMoveCreationAlbum={onMoveCreationAlbum}
      />
    </ScrollArea>
  );
}

function MaterialResults({
  albums,
  overviewCreationCollections,
  creationSectionTitle,
  albumSectionTitle,
  materialSectionTitle,
  overviewMode,
  materialTotal,
  materials,
  selectedKey,
  checkedKeys,
  selectionMode,
  selectionAvailable,
  loading,
  albumMutationBusy,
  onOpenAlbum,
  canMoveCreationAlbum,
  onMoveCreationAlbum,
  canMoveAlbum,
  onMoveAlbum,
  onCollectMaterials,
  onImportFiles,
  onArchiveAlbum,
  onDeleteAlbum,
  onSelect,
  onEnterSelection,
  onToggleSelection,
  onCopyText,
  onArchiveMaterial,
  onDeleteMaterial,
  notify,
  onDragStart,
  revealContextForItem,
  viewportRef,
}: Props) {
  const { messages } = useI18n();
  const hasCreationCollections = overviewCreationCollections.length > 0;
  const hasAlbums = albums.length > 0;
  const hasMaterials = materials.length > 0;
  const hasOrganizedCollections = hasCreationCollections || hasAlbums;
  const showMaterialZone = hasAlbums || hasMaterials || loading;

  if (overviewMode) {
    if (!hasCreationCollections && !showMaterialZone) return null;
    return (
      <section
        data-slot="material-overview"
        aria-labelledby={hasCreationCollections ? 'creation-zone-heading' : 'material-zone-heading'}
        className="px-4 pt-4 pb-4 sm:px-6 sm:pt-6 sm:pb-6"
      >
        {hasCreationCollections && creationSectionTitle && (
          <div className="mb-3 flex items-baseline gap-2">
            <h2 id="creation-zone-heading" className="text-sm font-semibold">
              {creationSectionTitle}
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">{overviewCreationCollections.length}</span>
          </div>
        )}
        {!hasCreationCollections && showMaterialZone && (
          <MaterialZoneHeading
            data-slot="material-zone-marker"
            headingId="material-zone-heading"
            title={messages.gallery.albums.materialZone}
            className="mb-6"
          />
        )}
        <MaterialZoneMasonry
          creationAlbums={overviewCreationCollections}
          albums={albums}
          materials={materials}
          materialZoneTitle={messages.gallery.albums.materialZone}
          selectedKey={selectedKey}
          checkedKeys={checkedKeys}
          selectionMode={selectionMode}
          selectionAvailable={selectionAvailable}
          loading={loading}
          albumMutationBusy={albumMutationBusy}
          onOpenAlbum={onOpenAlbum}
          canMoveCreationAlbum={canMoveCreationAlbum}
          onMoveCreationAlbum={onMoveCreationAlbum}
          canMoveAlbum={canMoveAlbum}
          onMoveAlbum={onMoveAlbum}
          onCollectMaterials={onCollectMaterials}
          onImportFiles={onImportFiles}
          onArchiveAlbum={onArchiveAlbum}
          onDeleteAlbum={onDeleteAlbum}
          onSelect={onSelect}
          onEnterSelection={onEnterSelection}
          onToggleSelection={onToggleSelection}
          onCopyText={onCopyText}
          onArchiveMaterial={onArchiveMaterial}
          onDeleteMaterial={onDeleteMaterial}
          notify={notify}
          onDragStart={onDragStart}
          revealContextForItem={revealContextForItem}
          viewportRef={viewportRef}
        />
      </section>
    );
  }

  return (
    <>
      {creationSectionTitle && (
        <CreationAlbumGrid
          viewportRef={viewportRef}
          albums={overviewCreationCollections}
          title={creationSectionTitle}
          busy={albumMutationBusy}
          onOpen={onOpenAlbum}
          canMoveCreationAlbum={canMoveCreationAlbum}
          onMoveCreationAlbum={onMoveCreationAlbum}
        />
      )}
      {albumSectionTitle && (
        <MaterialAlbumGrid
          title={albumSectionTitle}
          albums={albums}
          busy={albumMutationBusy}
          onOpen={onOpenAlbum}
          canMoveAlbum={canMoveAlbum}
          onMoveAlbum={onMoveAlbum}
          onCollectMaterials={onCollectMaterials}
          onImportFiles={onImportFiles}
          onArchive={onArchiveAlbum}
          onDelete={onDeleteAlbum}
        />
      )}
      {(hasMaterials || loading) && (
        <section
          data-slot="material-card-section"
          className={cn('px-4 pb-4 sm:px-6 sm:pb-6', hasOrganizedCollections ? 'pt-6' : 'pt-4 sm:pt-6')}
        >
          {materialSectionTitle && (
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">{materialSectionTitle}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{materialTotal}</span>
            </div>
          )}
          {loading && !hasMaterials ? (
            <MaterialSkeletonGrid />
          ) : (
            <MaterialMasonry
              items={materials}
              selectedKey={selectedKey}
              checkedKeys={checkedKeys}
              selectionMode={selectionMode}
              selectionAvailable={selectionAvailable}
              onSelect={onSelect}
              onEnterSelection={onEnterSelection}
              onToggleSelection={onToggleSelection}
              onCopyText={onCopyText}
              onArchive={onArchiveMaterial}
              onDelete={onDeleteMaterial}
              lifecycleBusy={albumMutationBusy}
              notify={notify}
              onDragStart={onDragStart}
              revealContextForItem={revealContextForItem}
              viewportRef={viewportRef}
            />
          )}
        </section>
      )}
    </>
  );
}

export function MaterialLibraryContent(props: Props) {
  const {
    albums,
    creationCollections,
    overviewCreationCollections,
    materialTotal,
    materials,
    loading,
    error,
    showingPreviousResults,
    searchActive,
    unratedActive,
    albumMutationBusy,
    viewportRef,
    pageEndRef,
    onOpenAlbum,
    canMoveCreationAlbum,
    onMoveCreationAlbum,
    onClearSearch,
    onClearUnrated,
    onRetry,
  } = props;
  const { messages } = useI18n();
  const l = messages.gallery.screen;
  if (creationCollections !== null) {
    return (
      <CreationCollectionBrowser
        albums={creationCollections}
        viewportRef={viewportRef}
        onOpen={onOpenAlbum}
        busy={albumMutationBusy}
        canMoveCreationAlbum={canMoveCreationAlbum}
        onMoveCreationAlbum={onMoveCreationAlbum}
      />
    );
  }
  const hasCreationCollections = overviewCreationCollections.length > 0;
  const hasAlbums = albums.length > 0;
  const hasMaterials = materials.length > 0;
  const hasOrganizedCollections = hasCreationCollections || hasAlbums;
  const fatalError = !loading && Boolean(error) && !hasOrganizedCollections && !hasMaterials;
  const empty = !loading && !error && !hasOrganizedCollections && !hasMaterials;

  if (fatalError) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-muted-foreground">
        <div className="grid justify-items-center gap-3">
          <ImageIcon className="size-8 opacity-40" />
          <strong className="text-sm text-foreground">{l.loadFailed}</strong>
          <small className="max-w-md break-words">{error}</small>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {l.retry}
          </Button>
        </div>
      </div>
    );
  }

  if (empty) {
    if (searchActive || unratedActive) {
      return (
        <QuietEmpty
          className="min-h-0 flex-1 place-content-center"
          title={searchActive ? l.emptySearch : l.emptyUnrated}
          actionLabel={searchActive ? messages.gallery.library.clearSearch : messages.gallery.library.clearAll}
          onAction={searchActive ? onClearSearch : onClearUnrated}
        />
      );
    }
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <strong className="text-sm font-medium">{l.empty}</strong>
      </div>
    );
  }

  return (
    <ScrollArea
      type="always"
      className={cn(
        'min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full',
        showingPreviousResults && 'pointer-events-none select-none',
      )}
      viewportRef={viewportRef}
    >
      <MaterialResults {...props} />

      <div className="flex min-h-16 items-center justify-center gap-3 px-4 pb-6 text-xs text-muted-foreground">
        {error ? (
          <>
            <span>{l.loadFailed}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {l.retry}
            </Button>
          </>
        ) : loading && hasMaterials ? (
          <span aria-live="polite">{l.loadingMore}</span>
        ) : (
          hasMaterials && (
            <span>
              {l.shown} {materials.length} / {materialTotal}
            </span>
          )
        )}
      </div>
      <div ref={pageEndRef} data-slot="material-page-end" className="h-px" aria-hidden="true" />
    </ScrollArea>
  );
}
