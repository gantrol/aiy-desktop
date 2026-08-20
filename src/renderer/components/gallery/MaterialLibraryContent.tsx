import { ArrowDownIcon, ImageIcon } from 'lucide-react';
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
  onCollectMaterials(albumId: string, targets: MaterialSelectionTargetInput[]): Promise<void>;
  onImportFiles?(album: MaterialAlbumDto, files: File[]): void;
  onSelect(item: MaterialLibraryItem, modifiers?: SelectionModifiers): void;
  onEnterSelection(item: MaterialLibraryItem): void;
  onToggleSelection(item: MaterialLibraryItem): void;
  onCopyText(text: string): void;
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
}: {
  albums: readonly MaterialAlbumDto[];
  viewportRef: RefObject<HTMLDivElement | null>;
  onOpen(albumId: string): void;
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
      <CreationAlbumGrid albums={albums} onOpen={onOpen} />
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
  onCollectMaterials,
  onImportFiles,
  onSelect,
  onEnterSelection,
  onToggleSelection,
  onCopyText,
  notify,
  onDragStart,
  revealContextForItem,
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
          <div data-slot="material-zone-marker" className="mb-5 flex justify-center">
            <div className="flex min-w-0 shrink items-center gap-2 rounded-full border bg-surface px-3 py-2 shadow-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken text-muted-foreground">
                <ArrowDownIcon className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="material-zone-heading" className="truncate text-sm font-semibold">
                  {messages.gallery.albums.materialZone}
                </h2>
              </div>
            </div>
          </div>
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
          onCollectMaterials={onCollectMaterials}
          onImportFiles={onImportFiles}
          onSelect={onSelect}
          onEnterSelection={onEnterSelection}
          onToggleSelection={onToggleSelection}
          onCopyText={onCopyText}
          notify={notify}
          onDragStart={onDragStart}
          revealContextForItem={revealContextForItem}
        />
      </section>
    );
  }

  return (
    <>
      {creationSectionTitle && (
        <CreationAlbumGrid albums={overviewCreationCollections} title={creationSectionTitle} onOpen={onOpenAlbum} />
      )}
      {albumSectionTitle && (
        <MaterialAlbumGrid
          title={albumSectionTitle}
          albums={albums}
          busy={albumMutationBusy}
          onOpen={onOpenAlbum}
          onCollectMaterials={onCollectMaterials}
          onImportFiles={onImportFiles}
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
              notify={notify}
              onDragStart={onDragStart}
              revealContextForItem={revealContextForItem}
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
    viewportRef,
    pageEndRef,
    onOpenAlbum,
    onClearSearch,
    onClearUnrated,
    onRetry,
  } = props;
  const { messages } = useI18n();
  const l = messages.gallery.screen;
  if (creationCollections !== null) {
    return <CreationCollectionBrowser albums={creationCollections} viewportRef={viewportRef} onOpen={onOpenAlbum} />;
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
