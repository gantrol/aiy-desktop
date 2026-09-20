import { useMemo, type DragEvent as ReactDragEvent, type RefObject } from 'react';
import type { AssetFileRevealContext, MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import { CollectionAlbumCard, CreationAlbumGrid } from '@/renderer/components/gallery/CreationAlbumGrid';
import { MaterialMasonry } from '@/renderer/components/gallery/MaterialMasonry';
import type { MaterialAlbumBrowseSummary } from '@/renderer/components/gallery/materialAlbumBrowse';
import type { MaterialLibraryItem, SelectionModifiers } from '@/renderer/components/gallery/materialLibraryTypes';
import { MaterialZoneHeading } from '@/renderer/components/gallery/MaterialZoneHeading';
import { CollectionMasonry, collectionCoverRatio } from '@/renderer/components/gallery/CollectionMasonry';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  creationAlbums: readonly MaterialAlbumDto[];
  albums: readonly MaterialAlbumBrowseSummary[];
  materials: readonly MaterialLibraryItem[];
  materialZoneTitle: string;
  selectedKey: string | null;
  checkedKeys: ReadonlySet<string>;
  selectionMode: boolean;
  selectionAvailable: boolean;
  loading: boolean;
  albumMutationBusy: boolean;
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
  viewportRef?: RefObject<HTMLElement | null>;
}

export function MaterialZoneMasonry({
  creationAlbums,
  albums,
  materials,
  materialZoneTitle,
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
  const skeletonCount = loading && !materials.length ? Math.max(4, 8 - albums.length) : 0;
  const albumCards = useMemo(
    () =>
      albums.map((summary) => ({
        ...summary.album,
        materialCount: summary.materialCount,
        previewAssets: summary.previewAssets,
      })),
    [albums],
  );
  const layoutItems = useMemo(
    () =>
      albumCards.map((album) => ({
        id: album.id,
        aspectRatio: collectionCoverRatio(album.previewAssets[0]),
      })),
    [albumCards],
  );
  const showMaterials = albums.length > 0 || materials.length > 0 || skeletonCount > 0;

  return (
    <div data-slot="material-overview-masonry">
      <CreationAlbumGrid
        albums={creationAlbums}
        className="p-0 sm:p-0"
        viewportRef={viewportRef}
        busy={albumMutationBusy}
        onOpen={onOpenAlbum}
        canMoveCreationAlbum={canMoveCreationAlbum}
        onMoveCreationAlbum={onMoveCreationAlbum}
      />
      {showMaterials && (
        <section className={creationAlbums.length ? 'mt-6' : undefined}>
          {creationAlbums.length > 0 && (
            <MaterialZoneHeading
              data-slot="creation-material-waterfall-boundary"
              headingId="material-zone-transition-heading"
              title={materialZoneTitle}
              className="mb-4"
            />
          )}
          {albums.length > 0 && (
            <CollectionMasonry
              items={layoutItems}
              viewportRef={viewportRef}
              renderItem={(_item, index) => {
                const album = albumCards[index];
                const summary = albums[index];
                const detail = [
                  messages.gallery.albums.materials(summary.materialCount),
                  ...(summary.childAlbumCount ? [messages.gallery.albums.childAlbums(summary.childAlbumCount)] : []),
                ].join(' · ');
                return (
                  <CollectionAlbumCard
                    album={album}
                    detail={detail}
                    childAlbumCount={summary.childAlbumCount}
                    busy={albumMutationBusy}
                    onOpen={onOpenAlbum}
                    canMoveAlbum={canMoveAlbum}
                    onMoveAlbum={onMoveAlbum}
                    onCollectMaterials={onCollectMaterials}
                    onImportFiles={onImportFiles}
                    onArchive={onArchiveAlbum}
                    onDelete={onDeleteAlbum}
                  />
                );
              }}
            />
          )}
          {(materials.length > 0 || skeletonCount > 0) && (
            <div className={albums.length ? 'mt-6' : undefined}>
              {skeletonCount > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-2">
                  {Array.from({ length: skeletonCount }, (_, index) => (
                    <Skeleton key={index} className="h-52 rounded-sm" />
                  ))}
                </div>
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
            </div>
          )}
        </section>
      )}
    </div>
  );
}
