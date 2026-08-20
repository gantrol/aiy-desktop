import { useEffect, useMemo, useRef } from 'react';
import type { AssetDto, BootstrapDto, VideoDocumentNavigationEntry, VideoDocumentSummaryDto } from '@/shared/contracts';
import { useAlbumTreeExpansion } from '@/renderer/components/albums/useAlbumTreeExpansion';
import { allAssets } from '@/renderer/components/creator/utils';
import {
  VideoDocumentNavigationTree,
  type VideoDocumentNavigationPageState,
  type VideoDocumentVisibleEntry,
} from '@/renderer/features/video-documents/VideoDocumentNavigationTree';
import { useI18n } from '@/renderer/i18n/useI18n';

interface FeatureDemoDirectoryTreeProps {
  data: BootstrapDto;
  openProgress: number;
}

type AlbumEntry = Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>;
type DocumentEntry = Extract<VideoDocumentNavigationEntry, { kind: 'DOCUMENT' }>;
type PreviewAsset = AlbumEntry['previewAssets'][number];

interface DemoMaterial {
  asset: PreviewAsset;
  title: string;
}

const rootAlbumId = 'feature-demo-root-album';
const childAlbumId = 'feature-demo-child-album';
const documentDurationsMs = [9 * 60_000 + 52_000, 5 * 60_000 + 9_000, 9 * 60_000 + 59_000];

function asPreviewAsset(asset: AssetDto): PreviewAsset | null {
  if (!asset.mimeType.startsWith('image/') || asset.width <= 0 || asset.height <= 0 || !asset.mediaUrl) return null;
  return {
    id: asset.id,
    kind: asset.kind,
    originType: asset.originType?.trim() || 'IMPORTED',
    mediaUrl: asset.mediaUrl,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize ?? 0,
    createdAt: asset.createdAt,
  };
}

function collectDemoMaterials(data: BootstrapDto) {
  const materials: DemoMaterial[] = [];
  const seen = new Set<string>();

  function add(asset: AssetDto, title: string) {
    if (seen.has(asset.id)) return;
    const previewAsset = asPreviewAsset(asset);
    if (!previewAsset) return;
    seen.add(asset.id);
    materials.push({ asset: previewAsset, title: title.trim() });
  }

  for (const series of data.series) {
    for (const output of series.importedOutputs ?? []) add(output.asset, output.displayName || series.title);
  }
  for (const series of data.series) {
    for (const asset of allAssets(series)) add(asset, series.title);
    if (series.cover) add(series.cover, series.title);
  }
  for (const album of data.albums) {
    for (const asset of album.previewAssets) add(asset, album.title);
    for (const asset of album.documentPreviewAssets ?? []) add(asset, album.title);
  }

  return materials;
}

function createDocumentEntry(
  material: DemoMaterial,
  index: number,
  locale: BootstrapDto['locale'],
  albumTitle: string,
  untitled: string,
): DocumentEntry {
  const documentId = `feature-demo-document-${index + 1}`;
  const title = material.title || untitled;
  const durationMs = documentDurationsMs[index % documentDurationsMs.length] ?? 60_000;
  const document: VideoDocumentSummaryDto = {
    id: documentId,
    title,
    titleLocale: locale,
    status: 'ACTIVE',
    albumId: childAlbumId,
    albumTitle,
    thumbnail: {
      assetId: material.asset.id,
      mediaUrl: material.asset.mediaUrl,
      width: material.asset.width,
      height: material.asset.height,
    },
    source: {
      relationId: `feature-demo-relation-${index + 1}`,
      materialId: material.asset.id,
      displayName: title,
      available: false,
      sourceUrl: null,
      audio: {
        status: 'NO_AUDIO',
        trackCount: 0,
        primaryCodec: null,
        detectedAt: null,
        errorCode: null,
      },
      asset: {
        ...material.asset,
        mediaKind: 'VIDEO',
        durationMs,
      },
    },
    createdAt: material.asset.createdAt,
    updatedAt: material.asset.createdAt,
  };
  return {
    nodeId: documentId,
    kind: 'DOCUMENT',
    documentId,
    parentAlbumId: childAlbumId,
    sortOrder: index,
    document,
  };
}

function page(items: VideoDocumentNavigationEntry[]): VideoDocumentNavigationPageState {
  return {
    items,
    nextCursor: null,
    loading: false,
    loadingMore: false,
    loaded: true,
  };
}

export function FeatureDemoDirectoryTree({ data, openProgress }: FeatureDemoDirectoryTreeProps) {
  const { messages } = useI18n();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { beginPointerTrack, openIds, setHover, setPersistent, togglePersistent, trackPointer } =
    useAlbumTreeExpansion(viewportRef);
  const rootOpen = openProgress >= 0.18;
  const childOpen = openProgress >= 0.62;
  const tree = useMemo(() => {
    const materials = collectDemoMaterials(data);
    const documentMaterials = materials.slice(0, 3);
    const rootTitle = data.spaceName.trim() || messages.videoDocuments.title;
    const childTitle =
      data.albums.find((album) => album.title.trim())?.title.trim() ||
      data.series.find((series) => series.title.trim())?.title.trim() ||
      messages.videoDocuments.collections;
    const documents = documentMaterials.map((material, index) =>
      createDocumentEntry(material, index, data.locale, childTitle, messages.videoDocuments.article.notes.untitled),
    );
    const childAlbum: AlbumEntry = {
      nodeId: childAlbumId,
      kind: 'ALBUM',
      albumId: childAlbumId,
      parentAlbumId: rootAlbumId,
      title: childTitle,
      sortOrder: 0,
      childCount: documents.length,
      descendantDocumentCount: documents.length,
      previewAssets: materials.slice(1, 5).map((material) => material.asset),
    };
    const rootAlbum: AlbumEntry = {
      nodeId: rootAlbumId,
      kind: 'ALBUM',
      albumId: rootAlbumId,
      parentAlbumId: null,
      title: rootTitle,
      sortOrder: 0,
      childCount: 1,
      descendantDocumentCount: documents.length,
      previewAssets: materials.slice(0, 4).map((material) => material.asset),
    };
    const children: Record<string, VideoDocumentNavigationPageState> = {
      [rootAlbumId]: page([childAlbum]),
      [childAlbumId]: page(documents),
    };
    return {
      root: page([rootAlbum]),
      children,
    };
  }, [data, messages.videoDocuments]);

  useEffect(() => {
    setPersistent(rootAlbumId, rootOpen);
    setPersistent(childAlbumId, childOpen);
  }, [childOpen, rootOpen, setPersistent]);

  const visibleEntries = useMemo(() => {
    const rows: VideoDocumentVisibleEntry[] = [];
    const visited = new Set<string>();
    function append(entries: VideoDocumentNavigationEntry[], depth: number, parentAlbumId: string | null) {
      for (const entry of entries) {
        if (visited.has(entry.nodeId)) continue;
        visited.add(entry.nodeId);
        rows.push({ entry, depth, parentAlbumId });
        if (entry.kind === 'ALBUM' && openIds.has(entry.albumId)) {
          append(tree.children[entry.albumId]?.items ?? [], depth + 1, entry.albumId);
        }
      }
    }
    append(tree.root.items, 0, null);
    return rows;
  }, [openIds, tree]);

  return (
    <div
      ref={viewportRef}
      data-feature-demo-live-directory-tree
      className="h-full overflow-y-auto overscroll-contain bg-surface-sunken"
    >
      <VideoDocumentNavigationTree
        root={tree.root}
        children={tree.children}
        visibleEntries={visibleEntries}
        selectedDocumentId={null}
        expandedAlbumIds={openIds}
        onToggleAlbum={(entry) => togglePersistent(entry.albumId)}
        onPullDownExpand={(entry) => setHover(entry.albumId, true)}
        onPointerTrackStart={beginPointerTrack}
        onPointerTrack={trackPointer}
        onSelectDocument={() => undefined}
        onLoadRootMore={() => undefined}
        onLoadChildrenMore={() => undefined}
        onMoveDocument={() => undefined}
        onMoveAlbum={() => undefined}
        onCreateAlbum={() => undefined}
        onRenameAlbum={() => undefined}
        onRenameDocument={() => undefined}
        onRequestMove={() => undefined}
        onReorder={() => undefined}
      />
    </div>
  );
}
