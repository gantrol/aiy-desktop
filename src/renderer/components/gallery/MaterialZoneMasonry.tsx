import { useMemo, useState, type DragEvent as ReactDragEvent } from 'react';
import type { AssetFileRevealContext, MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import {
  COLLECTION_GAP,
  COLLECTION_MIN_COLUMN_WIDTH,
  CollectionAlbumCard,
  collectionAspectRatio,
  previewSpreadForPlacement,
} from '@/renderer/components/gallery/CreationAlbumGrid';
import { getMaterialCardAspectRatio, MaterialCard } from '@/renderer/components/gallery/MaterialCard';
import type { MaterialAlbumBrowseSummary } from '@/renderer/components/gallery/materialAlbumBrowse';
import type { MaterialLibraryItem, SelectionModifiers } from '@/renderer/components/gallery/materialLibraryTypes';
import { MaterialZoneHeading } from '@/renderer/components/gallery/MaterialZoneHeading';
import {
  ShortestColumnMasonry,
  type MasonryLayout,
  type MasonrySectionBreak,
} from '@/renderer/components/ui/shortest-column-masonry';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';

const MATERIAL_ZONE_GAP = 104;
const MATERIAL_ZONE_LINE_OFFSET = MATERIAL_ZONE_GAP / 2;
const MAX_COLLECTION_PREVIEWS = 5;

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
  onSelect(item: MaterialLibraryItem, modifiers?: SelectionModifiers): void;
  onEnterSelection(item: MaterialLibraryItem): void;
  onToggleSelection(item: MaterialLibraryItem): void;
  onCopyText(text: string): void;
  notify(message: string): void;
  onDragStart?(event: ReactDragEvent<HTMLElement>, item: MaterialLibraryItem): void;
  revealContextForItem?(item: MaterialLibraryItem): AssetFileRevealContext | undefined;
}

type MaterialZoneEntry =
  | { id: string; kind: 'CREATION'; album: MaterialAlbumDto }
  | { id: string; kind: 'ALBUM'; summary: MaterialAlbumBrowseSummary; album: MaterialAlbumDto }
  | { id: string; kind: 'MATERIAL'; item: MaterialLibraryItem }
  | { id: string; kind: 'SKELETON' };

function albumForCard(summary: MaterialAlbumBrowseSummary): MaterialAlbumDto {
  return {
    ...summary.album,
    materialCount: summary.materialCount,
    previewAssets: summary.previewAssets,
  };
}

function creationColumnEnds(layout: Readonly<MasonryLayout>, creationCount: number) {
  const ends = Array.from<number | null>({ length: layout.columnCount }).fill(null);
  for (const placement of layout.placements) {
    if (placement.index >= creationCount) break;
    ends[placement.column] = Math.max(ends[placement.column] ?? 0, placement.y + placement.height);
  }
  const occupiedEnds = ends.flatMap((end) => (end === null ? [] : [end]));
  const fallbackEnd = occupiedEnds.length ? Math.min(...occupiedEnds) : 0;
  return ends.map((end) => end ?? fallbackEnd);
}

function MaterialZoneBoundary({
  layout,
  creationCount,
  title,
}: {
  layout: Readonly<MasonryLayout>;
  creationCount: number;
  title: string;
}) {
  if (layout.columnWidth <= 0) return null;
  const columnEnds = creationColumnEnds(layout, creationCount);
  const lineTops = columnEnds.map((end) => end + MATERIAL_ZONE_LINE_OFFSET);
  const labelColumn = columnEnds.indexOf(Math.min(...columnEnds));
  const labelLeadingBridge = labelColumn > 0 ? COLLECTION_GAP / 2 : 0;
  const labelTrailingBridge = labelColumn < layout.columnCount - 1 ? COLLECTION_GAP / 2 : 0;

  return (
    <div
      data-slot="creation-material-waterfall-boundary"
      role="separator"
      aria-labelledby="material-zone-transition-heading"
      className="pointer-events-none absolute inset-x-0 top-0 z-20"
    >
      <div aria-hidden="true">
        {lineTops.map((top, column) => {
          if (column === labelColumn) return null;
          const leadingBridge = column > 0 ? COLLECTION_GAP / 2 : 0;
          const trailingBridge = column < layout.columnCount - 1 ? COLLECTION_GAP / 2 : 0;
          return (
            <span
              key={`horizontal:${column}`}
              className="absolute h-px bg-border"
              style={{
                left: column * (layout.columnWidth + COLLECTION_GAP) - leadingBridge,
                top,
                width: layout.columnWidth + leadingBridge + trailingBridge,
              }}
            />
          );
        })}
        {lineTops.slice(0, -1).map((top, column) => {
          const nextTop = lineTops[column + 1];
          return (
            <span
              key={`vertical:${column}`}
              className="absolute w-px bg-border"
              style={{
                left: (column + 1) * (layout.columnWidth + COLLECTION_GAP) - COLLECTION_GAP / 2,
                top: Math.min(top, nextTop),
                height: Math.abs(top - nextTop),
              }}
            />
          );
        })}
      </div>
      <MaterialZoneHeading
        headingId="material-zone-transition-heading"
        title={title}
        className="absolute -translate-y-1/2"
        style={{
          left: labelColumn * (layout.columnWidth + COLLECTION_GAP) - labelLeadingBridge,
          top: lineTops[labelColumn],
          width: layout.columnWidth + labelLeadingBridge + labelTrailingBridge,
        }}
      />
    </div>
  );
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
  onSelect,
  onEnterSelection,
  onToggleSelection,
  onCopyText,
  notify,
  onDragStart,
  revealContextForItem,
}: Props) {
  const { messages } = useI18n();
  const [masonryLayout, setMasonryLayout] = useState<MasonryLayout | null>(null);
  const skeletonCount = loading && !materials.length ? Math.max(4, 8 - albums.length) : 0;
  const showBoundary = creationAlbums.length > 0 && (albums.length > 0 || materials.length > 0 || skeletonCount > 0);
  const sectionBreak = useMemo<MasonrySectionBreak | undefined>(
    () => (showBoundary ? { index: creationAlbums.length, gap: MATERIAL_ZONE_GAP } : undefined),
    [creationAlbums.length, showBoundary],
  );
  const entries = useMemo<MaterialZoneEntry[]>(() => {
    const creationEntries: MaterialZoneEntry[] = creationAlbums.map((album) => ({
      id: `creation:${album.id}`,
      kind: 'CREATION',
      album,
    }));
    const albumEntries: MaterialZoneEntry[] = albums.map((summary) => ({
      id: `album:${summary.album.id}`,
      kind: 'ALBUM',
      summary,
      album: albumForCard(summary),
    }));
    const materialEntries: MaterialZoneEntry[] = materials.map((item) => ({
      id: `material:${item.key}`,
      kind: 'MATERIAL',
      item,
    }));
    const skeletonEntries: MaterialZoneEntry[] = Array.from({ length: skeletonCount }, (_, index) => ({
      id: `material-skeleton:${index}`,
      kind: 'SKELETON',
    }));
    return [...creationEntries, ...albumEntries, ...materialEntries, ...skeletonEntries];
  }, [albums, creationAlbums, materials, skeletonCount]);
  const layoutItems = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        aspectRatio:
          entry.kind === 'CREATION' || entry.kind === 'ALBUM'
            ? collectionAspectRatio(entry.album.previewAssets[0])
            : entry.kind === 'MATERIAL'
              ? getMaterialCardAspectRatio(entry.item)
              : 4 / 3,
      })),
    [entries],
  );

  return (
    <div data-slot="material-overview-masonry" className="relative">
      <ShortestColumnMasonry
        items={layoutItems}
        minColumnWidth={COLLECTION_MIN_COLUMN_WIDTH}
        gap={COLLECTION_GAP}
        sectionBreak={sectionBreak}
        onLayoutChange={showBoundary ? setMasonryLayout : undefined}
        renderItem={(_item, index, placement, layout) => {
          const entry = entries[index];
          if (entry.kind === 'SKELETON') return <Skeleton className="size-full rounded-xl" />;
          if (entry.kind === 'MATERIAL') {
            return (
              <MaterialCard
                item={entry.item}
                selected={entry.item.key === selectedKey}
                checked={checkedKeys.has(entry.item.key)}
                selectionMode={selectionMode}
                selectionAvailable={selectionAvailable}
                viewMode="GRID"
                onSelect={onSelect}
                onEnterSelection={onEnterSelection}
                onToggleSelection={onToggleSelection}
                onCopyText={onCopyText}
                notify={notify}
                onDragStart={onDragStart}
                revealContext={revealContextForItem?.(entry.item)}
              />
            );
          }
          if (entry.kind === 'CREATION') {
            return (
              <CollectionAlbumCard
                album={entry.album}
                containerAspectRatio={layoutItems[index].aspectRatio}
                spread={previewSpreadForPlacement(
                  Math.min(entry.album.previewAssets.length, MAX_COLLECTION_PREVIEWS),
                  placement,
                  layout,
                )}
                busy={albumMutationBusy}
                onOpen={onOpenAlbum}
                canMoveCreationAlbum={canMoveCreationAlbum}
                onMoveCreationAlbum={onMoveCreationAlbum}
              />
            );
          }
          const detail = [
            messages.gallery.albums.materials(entry.summary.materialCount),
            ...(entry.summary.childAlbumCount
              ? [messages.gallery.albums.childAlbums(entry.summary.childAlbumCount)]
              : []),
          ].join(' · ');
          return (
            <CollectionAlbumCard
              album={entry.album}
              containerAspectRatio={layoutItems[index].aspectRatio}
              spread={previewSpreadForPlacement(entry.album.previewAssets.length, placement, layout)}
              detail={detail}
              childAlbumCount={entry.summary.childAlbumCount}
              busy={albumMutationBusy}
              onOpen={onOpenAlbum}
              canMoveAlbum={canMoveAlbum}
              onMoveAlbum={onMoveAlbum}
              onCollectMaterials={onCollectMaterials}
              onImportFiles={onImportFiles}
            />
          );
        }}
      />
      {showBoundary && masonryLayout && (
        <MaterialZoneBoundary layout={masonryLayout} creationCount={creationAlbums.length} title={materialZoneTitle} />
      )}
    </div>
  );
}
