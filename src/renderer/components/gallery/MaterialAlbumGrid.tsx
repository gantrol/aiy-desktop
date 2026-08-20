import { useMemo } from 'react';
import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import {
  COLLECTION_GAP,
  COLLECTION_MIN_COLUMN_WIDTH,
  CollectionAlbumCard,
  collectionAspectRatio,
  previewSpreadForPlacement,
} from '@/renderer/components/gallery/CreationAlbumGrid';
import type { MaterialAlbumBrowseSummary } from '@/renderer/components/gallery/materialAlbumBrowse';
import { ShortestColumnMasonry } from '@/renderer/components/ui/shortest-column-masonry';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  title: string;
  albums: readonly MaterialAlbumBrowseSummary[];
  busy?: boolean;
  onOpen(albumId: string): void;
  onCollectMaterials(albumId: string, targets: MaterialSelectionTargetInput[]): Promise<void>;
  onImportFiles?(album: MaterialAlbumDto, files: File[]): void;
}

function albumForCard(summary: MaterialAlbumBrowseSummary): MaterialAlbumDto {
  return {
    ...summary.album,
    materialCount: summary.materialCount,
    previewAssets: summary.previewAssets,
  };
}

export function MaterialAlbumGrid({ title, albums, busy, onOpen, onCollectMaterials, onImportFiles }: Props) {
  const { messages } = useI18n();
  const cardAlbums = useMemo(() => albums.map(albumForCard), [albums]);
  const layoutItems = useMemo(
    () =>
      cardAlbums.map((album) => ({
        id: album.id,
        aspectRatio: collectionAspectRatio(album.previewAssets[0]),
      })),
    [cardAlbums],
  );
  if (!albums.length) return null;

  return (
    <section data-slot="material-album-grid" className="px-4 pt-4 sm:px-6 sm:pt-6">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{albums.length}</span>
      </div>
      <ShortestColumnMasonry
        items={layoutItems}
        minColumnWidth={COLLECTION_MIN_COLUMN_WIDTH}
        gap={COLLECTION_GAP}
        renderItem={(_item, index, placement, layout) => {
          const summary = albums[index];
          const album = cardAlbums[index];
          const detail = [
            messages.gallery.albums.materials(summary.materialCount),
            ...(summary.childAlbumCount ? [messages.gallery.albums.childAlbums(summary.childAlbumCount)] : []),
          ].join(' · ');
          return (
            <CollectionAlbumCard
              album={album}
              containerAspectRatio={layoutItems[index].aspectRatio}
              spread={previewSpreadForPlacement(album.previewAssets.length, placement, layout)}
              detail={detail}
              childAlbumCount={summary.childAlbumCount}
              busy={busy}
              onOpen={onOpen}
              onCollectMaterials={onCollectMaterials}
              onImportFiles={onImportFiles}
            />
          );
        }}
      />
    </section>
  );
}
