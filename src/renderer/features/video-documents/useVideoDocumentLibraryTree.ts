import { useEffect, useMemo, useRef } from 'react';
import type { AlbumDto, VideoDocumentNavigationEntry } from '@/shared/contracts';
import type { VideoDocumentsLocation } from '@/renderer/components/app/app-navigation';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { useTreeBranchExpansion } from '@/renderer/components/albums/useTreeBranchExpansion';
import type {
  VideoDocumentNavigationPageState,
  VideoDocumentVisibleEntry,
} from '@/renderer/features/video-documents/VideoDocumentNavigationTree';

interface Params {
  albums: AlbumDto[];
  location: VideoDocumentsLocation;
  root: VideoDocumentNavigationPageState;
  children: Record<string, VideoDocumentNavigationPageState>;
  showEmptyAlbums: boolean;
  onExpandAlbum(albumId: string): void;
}

export function useVideoDocumentLibraryTree({
  albums,
  location,
  root,
  children,
  showEmptyAlbums,
  onExpandAlbum,
}: Params) {
  const albumIndex = useMemo(() => buildAlbumTreeIndex(albums), [albums]);
  const navigationViewportRef = useRef<HTMLDivElement | null>(null);
  const albumExpansion = useTreeBranchExpansion(navigationViewportRef);
  const expandedAlbumIds = albumExpansion.openIds;
  const setAlbumPersistent = albumExpansion.setPersistent;

  useEffect(() => {
    if (location.collection.kind !== 'album') return;
    const ids: string[] = [];
    let current: string | undefined = location.collection.albumId;
    while (current) {
      ids.unshift(current);
      current = albumIndex.parentById.get(current);
    }
    ids.forEach((albumId) => {
      setAlbumPersistent(albumId, true);
      onExpandAlbum(albumId);
    });
  }, [albumIndex, location.collection, onExpandAlbum, setAlbumPersistent]);

  useEffect(() => {
    if (!root.loaded) return;
    for (const albumId of expandedAlbumIds) {
      if (!children[albumId]?.loaded && !children[albumId]?.loading) onExpandAlbum(albumId);
    }
  }, [children, expandedAlbumIds, onExpandAlbum, root.loaded]);

  const emptyAlbumCount = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of [...root.items, ...Object.values(children).flatMap((page) => page.items)]) {
      if (entry.kind === 'ALBUM' && entry.descendantDocumentCount === 0) ids.add(entry.albumId);
    }
    return ids.size;
  }, [children, root.items]);

  const visibleEntries = useMemo(() => {
    const rows: VideoDocumentVisibleEntry[] = [];
    const visited = new Set<string>();
    const append = (entries: VideoDocumentNavigationEntry[], depth: number, parentAlbumId: string | null) => {
      for (const entry of entries) {
        if (visited.has(entry.nodeId)) continue;
        visited.add(entry.nodeId);
        if (!showEmptyAlbums && entry.kind === 'ALBUM' && entry.descendantDocumentCount === 0) continue;
        rows.push({ entry, depth, parentAlbumId });
        if (entry.kind === 'ALBUM' && expandedAlbumIds.has(entry.albumId)) {
          append(children[entry.albumId]?.items ?? [], depth + 1, entry.albumId);
        }
      }
    };
    append(root.items, 0, null);
    return rows;
  }, [children, expandedAlbumIds, root.items, showEmptyAlbums]);

  function toggleAlbum(entry: Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>) {
    albumExpansion.togglePersistent(entry.albumId);
    onExpandAlbum(entry.albumId);
  }

  function gestureExpand(entry: Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>) {
    albumExpansion.expandFromGesture(entry.albumId);
    onExpandAlbum(entry.albumId);
  }

  return {
    beginPointerTrack: albumExpansion.beginPointerTrack,
    emptyAlbumCount,
    expandedAlbumIds,
    navigationViewportRef,
    gestureExpand,
    toggleAlbum,
    trackPointer: albumExpansion.trackPointer,
    visibleEntries,
  };
}
