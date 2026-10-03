import { useRef, useState, type DragEvent } from 'react';
import {
  endCreationTreeDrag,
  readCreationTreeDrag,
  writeAlbumDrag,
  writeCreationItemDrag,
  type CreationTreeDrag,
} from '@/renderer/components/albums/albumDrag';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { acceptsItemTransfer, itemDragIntent } from '@/renderer/components/albums/itemDrag';
import type { CreationItemProjection } from '@/renderer/components/creator/creationLibraryProjection';

interface Options {
  busy?: boolean;
  tree: AlbumTreeIndex;
  itemById: ReadonlyMap<string, CreationItemProjection>;
  onMoveAlbum(albumId: string, parentAlbumId: string | null, copy?: boolean): Promise<void>;
  onMoveCreationItem(creationItemId: string, albumId: string | null, copy?: boolean): Promise<void>;
  onImportExternalFiles?(albumId: string, files: File[], sourceUrl: string): void;
}

/** Normal branches and their pinned paths share the same destination and validation. */
export function useCreationLibraryDrag(options: Options) {
  const [source, setSource] = useState<CreationTreeDrag | null>(null);
  const [dropAlbumId, setDropAlbumId] = useState<string | null>(null);
  const moving = useRef(false);

  function clearDrag() {
    endCreationTreeDrag();
    setSource(null);
    setDropAlbumId(null);
  }

  function dropEffect(event: DragEvent, albumId: string | null): 'copy' | 'move' | 'none' {
    const { tree, itemById } = options;
    if (options.busy || moving.current) return 'none';
    if (albumId && (!tree.byId.has(albumId) || tree.effectivelyArchived.has(albumId))) return 'none';
    if (event.dataTransfer.types.includes('Files')) return albumId && options.onImportExternalFiles ? 'copy' : 'none';
    if (!acceptsItemTransfer(event)) return 'none';
    const dragged = readCreationTreeDrag(event.dataTransfer);
    if (!dragged) return 'none';
    const effect = itemDragIntent(event) === 'COPY' ? 'copy' : 'move';
    if (dragged.kind === 'CREATION_ITEM') {
      const item = itemById.get(dragged.id);
      return item && (item.item.albumId !== albumId || effect === 'copy') ? effect : 'none';
    }
    if (!tree.byId.has(dragged.id) || tree.effectivelyArchived.has(dragged.id)) return 'none';
    if ((tree.parentById.get(dragged.id) ?? null) === albumId && effect !== 'copy') return 'none';
    let ancestor = albumId;
    const visited = new Set<string>();
    while (ancestor) {
      if (ancestor === dragged.id || visited.has(ancestor)) return 'none';
      visited.add(ancestor);
      ancestor = tree.parentById.get(ancestor) ?? null;
    }
    return effect;
  }

  async function drop(event: DragEvent, albumId: string | null) {
    const dragged = readCreationTreeDrag(event.dataTransfer);
    if (albumId === null && !dragged) return;
    event.preventDefault();
    event.stopPropagation();
    const effect = dropEffect(event, albumId);
    clearDrag();
    if (effect === 'none') return;
    if (albumId && event.dataTransfer.types.includes('Files')) {
      const files = [...event.dataTransfer.files];
      if (files.length) options.onImportExternalFiles?.(albumId, files, 'file-drop');
      return;
    }
    if (!dragged) return;
    moving.current = true;
    try {
      if (dragged.kind === 'CREATION_ITEM') await options.onMoveCreationItem(dragged.id, albumId, effect === 'copy');
      else await options.onMoveAlbum(dragged.id, albumId, effect === 'copy');
    } finally {
      moving.current = false;
    }
  }

  function dropProps(albumId: string | null) {
    const hover = (event: DragEvent) => {
      if (albumId === null && !readCreationTreeDrag(event.dataTransfer)) return;
      // Even a rejected child target owns the event; it must not fall through to an ancestor or root.
      event.preventDefault();
      event.stopPropagation();
      const effect = dropEffect(event, albumId);
      event.dataTransfer.dropEffect = effect;
      setDropAlbumId(effect === 'none' ? null : albumId);
    };
    return {
      onDragEnter: hover,
      onDragOver: hover,
      onDragLeave(event: DragEvent) {
        event.stopPropagation();
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setDropAlbumId((current) => (current === albumId ? null : current));
      },
      onDrop: (event: DragEvent) => void drop(event, albumId),
    };
  }

  return {
    draggedCreationItemId: source?.kind === 'CREATION_ITEM' ? source.id : null,
    draggedAlbumId: source?.kind === 'ALBUM' ? source.id : null,
    dropAlbumId,
    dropProps,
    clearDrag,
    startCreationItemDrag(event: DragEvent, id: string) {
      writeCreationItemDrag(event.dataTransfer, id);
      setSource({ kind: 'CREATION_ITEM', id });
    },
    startAlbumDrag(event: DragEvent, id: string) {
      writeAlbumDrag(event.dataTransfer, id);
      setSource({ kind: 'ALBUM', id });
    },
  };
}
