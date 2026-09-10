import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { CreationItemDto } from '@/shared/contracts';
import { endCreationTreeDrag, readCreationTreeDrag } from '@/renderer/components/albums/albumDrag';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';

interface Options {
  albumId: string;
  tree: AlbumTreeIndex;
  creationItems: readonly CreationItemDto[];
  busy: boolean;
  onMoveAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  onMoveCreationItem(creationItemId: string, albumId: string | null): Promise<void>;
}

export function useCreationAlbumDrop(options: Options) {
  const [active, setActive] = useState(false);
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  useEffect(() => {
    const clear = () => setActive(false);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  function allowedTarget(event: DragEvent) {
    const target = readCreationTreeDrag(event.dataTransfer);
    const { albumId, tree } = options;
    if (!target || options.busy || movingRef.current || tree.effectivelyArchived.has(albumId)) return null;
    if (target.kind === 'CREATION_ITEM') {
      const item = options.creationItems.find((candidate) => candidate.id === target.id);
      return item &&
        item.albumId !== albumId &&
        item.lifecycle === 'ACTIVE' &&
        !(item.albumId && tree.effectivelyArchived.has(item.albumId))
        ? target
        : null;
    }
    if (
      !tree.byId.has(target.id) ||
      tree.effectivelyArchived.has(target.id) ||
      tree.parentById.get(target.id) === albumId
    )
      return null;
    let ancestor: string | undefined = albumId;
    const visited = new Set<string>();
    while (ancestor) {
      if (ancestor === target.id || visited.has(ancestor)) return null;
      visited.add(ancestor);
      ancestor = tree.parentById.get(ancestor);
    }
    return target;
  }

  function onDragOver(event: DragEvent) {
    if (!readCreationTreeDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const accepted = Boolean(allowedTarget(event));
    event.dataTransfer.dropEffect = accepted ? 'move' : 'none';
    setActive(accepted);
  }

  async function onDrop(event: DragEvent) {
    if (!readCreationTreeDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = allowedTarget(event);
    setActive(false);
    endCreationTreeDrag();
    if (!target) return;
    movingRef.current = true;
    setMoving(true);
    try {
      if (target.kind === 'ALBUM') await options.onMoveAlbum(target.id, options.albumId);
      else await options.onMoveCreationItem(target.id, options.albumId);
    } catch {
      // Shared library actions report failures and refresh authoritative state.
    } finally {
      movingRef.current = false;
      setMoving(false);
    }
  }

  return {
    active,
    moving,
    handlers: {
      onDragEnter: onDragOver,
      onDragOver,
      onDragLeave(event: DragEvent) {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setActive(false);
      },
      onDrop: (event: DragEvent) => void onDrop(event),
    },
  };
}
