import { useRef, useState, type DragEvent } from 'react';
import {
  endCreationTreeDrag,
  readCreationTreeDrag,
  writeAlbumDrag,
  writeCreationItemDrag,
} from '@/renderer/components/albums/albumDrag';
import { CREATION_OUTLINE_BATCH_LIMIT } from '@/shared/contracts/creation-outline';
import {
  canMoveOutlineTo,
  outermostSelection,
  type OutlineNode,
  type OutlineTree,
} from '@/renderer/features/creation-outline/outline-tree';

const dragType = 'application/x-aiy-creation-outline';

export function useOutlineDrag(
  tree: OutlineTree,
  selection: readonly string[],
  busy: boolean,
  move: (nodes: readonly OutlineNode[], albumId: string | null) => Promise<void>,
) {
  const [dropKey, setDropKey] = useState<string | null>(null);
  const dragged = useRef<string[]>([]);
  function clear() {
    dragged.current = [];
    setDropKey(null);
    endCreationTreeDrag();
  }
  function nodesFor(event: DragEvent) {
    if (event.dataTransfer.types.includes(dragType) && dragged.current.length)
      return outermostSelection(tree, dragged.current);
    const external = readCreationTreeDrag(event.dataTransfer);
    const key = external ? (external.kind === 'ALBUM' ? 'album:' : 'creation:') + external.id : null;
    return key ? outermostSelection(tree, [key]) : [];
  }
  function over(event: DragEvent, albumId: string | null, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const nodes = nodesFor(event);
    const valid = !busy && nodes.length <= CREATION_OUTLINE_BATCH_LIMIT && canMoveOutlineTo(tree, nodes, albumId);
    event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    setDropKey(valid ? key : null);
  }
  function drop(event: DragEvent, albumId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const nodes = nodesFor(event);
    clear();
    if (!busy) void move(nodes, albumId);
  }
  function ignore(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'none';
    if (event.type === 'drop') clear();
    else setDropKey(null);
  }
  function leave(event: DragEvent<HTMLElement>) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropKey(null);
  }
  function start(event: DragEvent, key: string) {
    const nodes = outermostSelection(tree, selection.includes(key) ? selection : [key]);
    if (busy || !nodes.length || nodes.some((node) => !node.target) || nodes.length > CREATION_OUTLINE_BATCH_LIMIT) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    endCreationTreeDrag();
    dragged.current = nodes.map((node) => node.key);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(dragType, JSON.stringify(dragged.current));
    // Other surfaces understand single-item drags only. Never expose one member of a batch as the entire selection.
    if (nodes.length === 1) {
      const target = nodes[0].target!;
      if (target.kind === 'ALBUM') writeAlbumDrag(event.dataTransfer, target.id);
      else writeCreationItemDrag(event.dataTransfer, target.id);
    }
  }
  return { dropKey, clear, over, drop, ignore, leave, start };
}
