import { useRef, useState, type DragEvent } from 'react';
import { acceptsItemTransfer, itemDragIntent } from '@/renderer/components/albums/itemDrag';
import { writeReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import {
  endCreationTreeDrag,
  readCreationTreeDrag,
  writeAlbumDrag,
  writeCreationItemDrag,
} from '@/renderer/components/albums/albumDrag';
import { CREATION_OUTLINE_BATCH_LIMIT } from '@/shared/contracts/creation-outline';
import type { ReferenceTarget } from '@/shared/contracts/content-source';
import {
  canMoveOutlineTo,
  outlineDestination,
  outermostSelection,
  type OutlineNode,
  type OutlineTree,
} from '@/renderer/features/creation-outline/outline-tree';

const dragType = 'application/x-aiy-creation-outline';

function referenceTarget(node: OutlineNode): ReferenceTarget | null {
  if (node.content)
    return {
      source: { kind: 'ARTICLE', id: node.content.articleId },
      blockId: node.content.blockId,
      scope: 'SELF',
    };
  if (node.articleId) return { source: { kind: 'ARTICLE', id: node.articleId } };
  const entity = node.form?.entityRef;
  if (entity && (entity.kind === 'ARTICLE' || entity.kind === 'SOCIAL_POST' || entity.kind === 'VIDEO_DOCUMENT'))
    return { source: { kind: entity.kind, id: entity.id } };
  return node.target ? { source: { kind: node.target.kind, id: node.target.id } } : null;
}

export function useOutlineDrag(
  tree: OutlineTree,
  selection: readonly string[],
  busy: boolean,
  move: (
    nodes: readonly OutlineNode[],
    albumId: string | null,
    copy?: boolean,
    parentCreationItemId?: string | null,
  ) => Promise<void>,
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
  function over(event: DragEvent, albumId: string | null, key: string, parentCreationItemId: string | null = null) {
    event.preventDefault();
    event.stopPropagation();
    const nodes = nodesFor(event);
    const valid =
      acceptsItemTransfer(event) &&
      !busy &&
      nodes.length <= CREATION_OUTLINE_BATCH_LIMIT &&
      canMoveOutlineTo(tree, nodes, albumId, itemDragIntent(event) === 'COPY', parentCreationItemId);
    event.dataTransfer.dropEffect = valid ? (itemDragIntent(event) === 'COPY' ? 'copy' : 'move') : 'none';
    setDropKey(valid ? key : null);
  }
  function drop(event: DragEvent, albumId: string | null, parentCreationItemId: string | null = null) {
    event.preventDefault();
    event.stopPropagation();
    const nodes = nodesFor(event);
    clear();
    if (!busy && acceptsItemTransfer(event))
      void move(nodes, albumId, itemDragIntent(event) === 'COPY', parentCreationItemId);
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
    const targets = nodes.map(referenceTarget);
    if (busy || !nodes.length || targets.some((target) => !target) || nodes.length > CREATION_OUTLINE_BATCH_LIMIT) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    endCreationTreeDrag();
    dragged.current = nodes.map((node) => node.key);
    event.dataTransfer.effectAllowed = 'all';
    event.dataTransfer.setData(dragType, JSON.stringify(dragged.current));
    // Other surfaces understand single-item drags only. Never expose one member of a batch as the entire selection.
    if (nodes.length === 1 && nodes[0].target) {
      const target = nodes[0].target!;
      if (target.kind === 'ALBUM') writeAlbumDrag(event.dataTransfer, target.id);
      else writeCreationItemDrag(event.dataTransfer, target.id);
    }
    writeReferenceDrag(
      event.dataTransfer,
      targets as ReferenceTarget[],
      undefined,
      targets.every((target) => target?.source.kind === 'ARTICLE') ? 'FOLLOW' : 'FIXED',
    );
  }
  function overNode(event: DragEvent, node: OutlineNode) {
    if (!node.target) return ignore(event);
    const destination = outlineDestination(node);
    over(event, destination.albumId, node.key, destination.parentCreationItemId);
  }
  function dropNode(event: DragEvent, node: OutlineNode) {
    if (!node.target) return ignore(event);
    const destination = outlineDestination(node);
    drop(event, destination.albumId, destination.parentCreationItemId);
  }
  return { dropKey, clear, over, drop, overNode, dropNode, ignore, leave, start };
}
