import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
  PencilIcon,
  VideoIcon,
} from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { VideoDocumentNavigationEntry } from '@/shared/contracts';
import type { AlbumMoveTarget } from '@/renderer/components/albums/AlbumMoveDialog';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import {
  itemDragStart,
  itemDragScopeProps,
  acceptsItemTransfer,
  itemDragIntent,
} from '@/renderer/components/albums/itemDrag';
import { writeReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import {
  readCreationTreeDrag,
  writeAlbumDrag,
  writeCreationItemDrag,
  endCreationTreeDrag,
} from '@/renderer/components/albums/albumDrag';
import { TreeBranchTransitRail } from '@/renderer/components/albums/TreeDisclosureRail';
import {
  getTreeBranchItemTopology,
  TREE_CONNECTION_GEOMETRY,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { CreationTreeNodeFrame } from '@/renderer/components/creator/CreationLibraryTreeItem';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { ItemActions, itemActionButtonClassName } from '@/renderer/components/ui/item-actions';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import {
  formatVideoDuration,
  VideoDocumentAlbumPreview,
  VideoDocumentPreview,
} from '@/renderer/features/video-documents/VideoDocumentNavigationPreviews';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export interface VideoDocumentNavigationPageState {
  items: VideoDocumentNavigationEntry[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
}

export interface VideoDocumentVisibleEntry {
  entry: VideoDocumentNavigationEntry;
  depth: number;
  parentAlbumId: string | null;
}

interface DragState {
  entry: VideoDocumentNavigationEntry;
  parentAlbumId: string | null;
}

function writeNavigationDrag(dataTransfer: DataTransfer, entry: VideoDocumentNavigationEntry) {
  if (entry.kind === 'ALBUM') writeAlbumDrag(dataTransfer, entry.albumId);
  else {
    writeCreationItemDrag(dataTransfer, entry.creationItemId);
    writeReferenceDrag(dataTransfer, [{ source: { kind: 'VIDEO_DOCUMENT', id: entry.documentId } }]);
  }
}

interface RowProps {
  row: VideoDocumentVisibleEntry;
  branchTopology?: TreeBranchItemTopology;
  ancestorRails: Array<{ depth: number; topology: TreeBranchItemTopology }>;
  selected: boolean;
  expanded: boolean;
  childPage?: VideoDocumentNavigationPageState;
  dragging: boolean;
  actions: ActionMenuAction[];
  onToggleAlbum(): void;
  onGestureExpand(): void;
  onPointerTrackStart(clientY: number): void;
  onPointerTrack(clientY: number): boolean;
  onOpenDocument(): void;
  onDragStart(): void;
  onDragEnd(): void;
  onDragOver(event: ReactDragEvent<HTMLDivElement>): void;
  onDrop(event: ReactDragEvent<HTMLDivElement>): void;
  onLoadMore(): void;
}

function NavigationEntryRow({
  row,
  branchTopology,
  ancestorRails,
  selected,
  expanded,
  childPage,
  dragging,
  actions,
  onToggleAlbum,
  onGestureExpand,
  onPointerTrackStart,
  onPointerTrack,
  onOpenDocument,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onLoadMore,
}: RowProps) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  const { entry } = row;
  const title = entry.kind === 'ALBUM' ? entry.title : entry.document.displayTitle;
  const expandable = entry.kind === 'ALBUM' && entry.childCount > 0;

  function activate() {
    if (entry.kind === 'ALBUM') onToggleAlbum();
    else onOpenDocument();
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(open) => {
        if (expandable && open !== expanded) onToggleAlbum();
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn('relative transition-opacity', dragging && 'opacity-45')}
            style={{ paddingLeft: row.depth * TREE_CONNECTION_GEOMETRY.contentIndentX }}
            data-album-branch-id={entry.kind === 'ALBUM' ? entry.albumId : undefined}
            data-tree-branch-id={entry.kind === 'ALBUM' ? entry.albumId : undefined}
          >
            {ancestorRails.map(({ depth, topology }) => (
              <span
                key={depth}
                className="absolute inset-y-0"
                style={{ left: depth * TREE_CONNECTION_GEOMETRY.contentIndentX }}
              >
                <TreeBranchTransitRail topology={topology} />
              </span>
            ))}
            {entry.kind === 'ALBUM' && branchTopology && (
              <span
                className="absolute inset-y-0"
                style={{ left: row.depth * TREE_CONNECTION_GEOMETRY.contentIndentX }}
              >
                <TreeBranchTransitRail topology={branchTopology} />
              </span>
            )}
            <div
              className={cn(
                'group/item relative flex h-[4.25rem] min-w-0 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-hover',
                selected &&
                  'text-selected-foreground before:pointer-events-none before:absolute before:inset-y-0.5 before:inset-x-0 before:rounded-sm before:bg-selected hover:bg-transparent',
              )}
              data-album-id={entry.kind === 'ALBUM' ? entry.albumId : undefined}
              data-tree-node-id={entry.kind === 'ALBUM' ? entry.albumId : undefined}
              {...itemDragScopeProps}
              draggable
              onDragStart={itemDragStart((event) => {
                writeNavigationDrag(event.dataTransfer, entry);
                onDragStart();
              })}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              {entry.kind === 'ALBUM' ? (
                <>
                  <button
                    type="button"
                    className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={title}
                    aria-expanded={expandable ? expanded : undefined}
                    onClick={(event) => {
                      if (event.detail <= 1) activate();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' && !expanded) {
                        event.preventDefault();
                        onToggleAlbum();
                      } else if (event.key === 'ArrowLeft' && expanded) {
                        event.preventDefault();
                        onToggleAlbum();
                      }
                    }}
                  />
                  <AlbumTreePreview
                    assets={entry.previewAssets}
                    title={entry.title}
                    open={expanded}
                    expandable={expandable}
                    expandLabel={expanded ? labels.collapseAlbum(entry.title) : labels.expandAlbum(entry.title)}
                    overlayStyle="solid"
                    branchTopology={branchTopology}
                    disclosureInteractive
                    onGestureExpand={onGestureExpand}
                    onPointerTrackStart={onPointerTrackStart}
                    onPointerTrack={onPointerTrack}
                    onClick={(event) => {
                      if (event.detail <= 1) activate();
                    }}
                    onDoubleClick={() => undefined}
                  />
                  <span className="pointer-events-none relative z-10 min-w-0 flex-1 px-1">
                    <strong className="line-clamp-2 block break-words text-base font-medium leading-5">{title}</strong>
                  </span>
                  {childPage?.loading && <LoaderCircleIcon className="relative z-10 size-3.5 animate-spin" />}
                </>
              ) : (
                <button
                  type="button"
                  className="relative z-10 flex min-w-0 flex-1 items-center gap-1 self-stretch text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={activate}
                >
                  <CreationTreeNodeFrame
                    bounds={{ left: 0, top: 0, right: 64, bottom: 36 }}
                    rowInsetY={16}
                    branchTopology={branchTopology}
                    className="-ml-1 flex h-[4.25rem] w-16 items-center"
                  >
                    <VideoDocumentPreview document={entry.document} />
                  </CreationTreeNodeFrame>
                  <span className="min-w-0 flex-1 px-1">
                    <strong className="line-clamp-2 block break-words text-base font-medium leading-5">{title}</strong>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {formatVideoDuration(entry.document.source.asset.durationMs)}
                    </span>
                  </span>
                </button>
              )}
              <ItemActions>
                <ActionMenuButton
                  actions={actions}
                  label={labels.sidebar.moreActions(title)}
                  className={itemActionButtonClassName}
                />
              </ItemActions>
            </div>
            {entry.kind === 'ALBUM' && expanded && childPage?.nextCursor && (
              <div className="px-3 py-1" style={{ paddingLeft: 64 + TREE_CONNECTION_GEOMETRY.contentIndentX }}>
                <Button type="button" variant="ghost" size="sm" disabled={childPage.loadingMore} onClick={onLoadMore}>
                  {childPage.loadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" />}
                  {labels.loadMore}
                </Button>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ActionContextMenuItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    </Collapsible>
  );
}

function CompactNavigationEntryRow({
  row,
  selected,
  expanded,
  childPage,
  dragging,
  actions,
  onToggleAlbum,
  onOpenDocument,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onLoadMore,
}: RowProps) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  const { entry } = row;
  const title = entry.kind === 'ALBUM' ? entry.title : entry.document.displayTitle;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn('relative grid w-full justify-items-center transition-opacity', dragging && 'opacity-45')}
          {...itemDragScopeProps}
          draggable
          onDragStart={itemDragStart((event) => {
            writeNavigationDrag(event.dataTransfer, entry);
            onDragStart();
          })}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <button
            type="button"
            title={title}
            aria-label={title}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'group relative grid size-16 place-items-center overflow-visible rounded-xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'bg-selected text-selected-foreground',
            )}
            onClick={entry.kind === 'ALBUM' ? onToggleAlbum : onOpenDocument}
          >
            <span className="scale-[0.88]">
              {entry.kind === 'ALBUM' ? (
                <VideoDocumentAlbumPreview entry={entry} expanded={expanded} loading={childPage?.loading} />
              ) : (
                <VideoDocumentPreview document={entry.document} />
              )}
            </span>
          </button>
          {entry.kind === 'ALBUM' && expanded && childPage?.nextCursor && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-item-drag-ignore
              className="h-6 max-w-[4.5rem] px-1 text-[10px]"
              disabled={childPage.loadingMore}
              onClick={onLoadMore}
            >
              {childPage.loadingMore && <LoaderCircleIcon className="size-3 animate-spin" />}
              {labels.loadMore}
            </Button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function moveBefore(entries: VideoDocumentNavigationEntry[], draggedId: string, targetId: string) {
  const dragged = entries.find((entry) => entry.nodeId === draggedId);
  if (!dragged || draggedId === targetId) return entries;
  const withoutDragged = entries.filter((entry) => entry.nodeId !== draggedId);
  const targetIndex = withoutDragged.findIndex((entry) => entry.nodeId === targetId);
  if (targetIndex < 0) return entries;
  withoutDragged.splice(targetIndex, 0, dragged);
  return withoutDragged;
}

function albumTargetContainsSource(
  sourceAlbumId: string,
  targetAlbumId: string | null,
  parentByAlbumId: ReadonlyMap<string, string | null>,
) {
  let current = targetAlbumId;
  const visited = new Set<string>();
  while (current) {
    if (current === sourceAlbumId || visited.has(current)) return true;
    visited.add(current);
    current = parentByAlbumId.get(current) ?? null;
  }
  return false;
}

interface Props {
  root: VideoDocumentNavigationPageState;
  children: Record<string, VideoDocumentNavigationPageState>;
  visibleEntries: VideoDocumentVisibleEntry[];
  selectedDocumentId: string | null;
  expandedAlbumIds: Set<string>;
  onToggleAlbum(entry: Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>): void;
  onGestureExpand(entry: Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>): void;
  onPointerTrackStart(albumId: string, clientY: number): void;
  onPointerTrack(albumId: string, clientY: number): boolean;
  onSelectDocument(documentId: string, parentAlbumId: string | null): void;
  onLoadRootMore(): void;
  onLoadChildrenMore(albumId: string): void;
  onMoveDocument(documentId: string, albumId: string | null, copy?: boolean): void | Promise<void>;
  onMoveCreationItem(creationItemId: string, albumId: string | null, copy?: boolean): void | Promise<void>;
  onMoveAlbum(albumId: string, parentAlbumId: string | null, copy?: boolean): void | Promise<void>;
  onOperationError(reason: unknown): void;
  onCreateAlbum(parentAlbumId: string | null): void;
  onRenameAlbum(albumId: string): void;
  onRenameDocument(documentId: string, title: string): void;
  onRequestMove(target: AlbumMoveTarget): void;
  onReorder(
    parentAlbumId: string | null,
    entries: Array<{ kind: 'ALBUM' | 'DOCUMENT'; targetId: string }>,
  ): void | Promise<void>;
  compact?: boolean;
}

export function VideoDocumentNavigationTree({
  root,
  children,
  visibleEntries,
  selectedDocumentId,
  expandedAlbumIds,
  onToggleAlbum,
  onGestureExpand,
  onPointerTrackStart,
  onPointerTrack,
  onSelectDocument,
  onLoadRootMore,
  onLoadChildrenMore,
  onMoveDocument,
  onMoveCreationItem,
  onMoveAlbum,
  onOperationError,
  onCreateAlbum,
  onRenameAlbum,
  onRenameDocument,
  onRequestMove,
  onReorder,
  compact = false,
}: Props) {
  const labels = useI18n().messages.videoDocuments;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dropPending = useRef(false);
  const parentByAlbumId = useMemo(
    () =>
      new Map(
        visibleEntries.flatMap((row) =>
          row.entry.kind === 'ALBUM' ? ([[row.entry.albumId, row.parentAlbumId]] as const) : [],
        ),
      ),
    [visibleEntries],
  );
  const placedEntries = useMemo(() => {
    const siblings = new Map<string | null, VideoDocumentVisibleEntry[]>();
    for (const row of visibleEntries) {
      const group = siblings.get(row.parentAlbumId) ?? [];
      group.push(row);
      siblings.set(row.parentAlbumId, group);
    }
    const topologies = new Map<string, TreeBranchItemTopology>();
    for (const group of siblings.values()) {
      group.forEach((row, index) => topologies.set(row.entry.nodeId, getTreeBranchItemTopology(index, group.length)));
    }
    const ancestors: Array<TreeBranchItemTopology | undefined> = [];
    return visibleEntries.map((row) => {
      ancestors.length = row.depth;
      const ancestorRails = ancestors.flatMap((topology, depth) =>
        topology?.hasSuccessor ? [{ depth, topology }] : [],
      );
      const branchTopology = row.depth > 0 ? topologies.get(row.entry.nodeId) : undefined;
      ancestors[row.depth] = branchTopology;
      return { row, branchTopology, ancestorRails };
    });
  }, [visibleEntries]);

  function siblingsFor(parentAlbumId: string | null) {
    return parentAlbumId ? (children[parentAlbumId]?.items ?? []) : root.items;
  }

  function submitOrder(parentAlbumId: string | null, entries: VideoDocumentNavigationEntry[]) {
    return onReorder(
      parentAlbumId,
      entries.map((entry) => ({
        kind: entry.kind,
        targetId: entry.kind === 'ALBUM' ? entry.albumId : entry.documentId,
      })),
    );
  }

  function dropTargetForRow(
    row: VideoDocumentVisibleEntry,
    event: ReactDragEvent<HTMLDivElement>,
    preferAlbum = false,
  ) {
    const source = readCreationTreeDrag(event.dataTransfer);
    if (!source || dropPending.current || !acceptsItemTransfer(event)) return null;
    const intent = itemDragIntent(event);
    const dropInside =
      row.entry.kind === 'ALBUM' &&
      (preferAlbum || event.clientX > event.currentTarget.getBoundingClientRect().left + 86);
    const parentAlbumId = dropInside && row.entry.kind === 'ALBUM' ? row.entry.albumId : row.parentAlbumId;
    if (source.kind === 'ALBUM' && albumTargetContainsSource(source.id, parentAlbumId, parentByAlbumId)) return null;
    if (dropInside || intent === 'COPY' || !drag || drag.parentAlbumId !== parentAlbumId)
      return { kind: 'TRANSFER' as const, source, parentAlbumId, copy: intent === 'COPY' };
    if (drag.entry.nodeId === row.entry.nodeId) return null;
    return { kind: 'REORDER' as const, parentAlbumId };
  }

  function dragOverRow(row: VideoDocumentVisibleEntry, event: ReactDragEvent<HTMLDivElement>, preferAlbum = false) {
    const target = dropTargetForRow(row, event, preferAlbum);
    event.stopPropagation();
    if (!target) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = target.kind === 'TRANSFER' && target.copy ? 'copy' : 'move';
  }

  async function dropOnRow(row: VideoDocumentVisibleEntry, event: ReactDragEvent<HTMLDivElement>, preferAlbum = false) {
    event.preventDefault();
    event.stopPropagation();
    const target = dropTargetForRow(row, event, preferAlbum);
    if (!target) return;
    dropPending.current = true;
    try {
      if (target.kind === 'TRANSFER') {
        if (target.source.kind === 'ALBUM') await onMoveAlbum(target.source.id, target.parentAlbumId, target.copy);
        else if (drag?.entry.kind === 'DOCUMENT' && drag.entry.creationItemId === target.source.id)
          await onMoveDocument(drag.entry.documentId, target.parentAlbumId, target.copy);
        else await onMoveCreationItem(target.source.id, target.parentAlbumId, target.copy);
      } else if (drag) {
        await submitOrder(
          target.parentAlbumId,
          moveBefore(siblingsFor(target.parentAlbumId), drag.entry.nodeId, row.entry.nodeId),
        );
      }
    } catch (reason) {
      onOperationError(reason);
    } finally {
      dropPending.current = false;
      setDrag(null);
    }
  }

  function reorderByStep(row: VideoDocumentVisibleEntry, delta: -1 | 1) {
    const siblings = siblingsFor(row.parentAlbumId);
    const index = siblings.findIndex((entry) => entry.nodeId === row.entry.nodeId);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!];
    void submitOrder(row.parentAlbumId, reordered);
  }

  function entryActions(row: VideoDocumentVisibleEntry, expanded: boolean): ActionMenuAction[] {
    const siblings = siblingsFor(row.parentAlbumId);
    const index = siblings.findIndex((entry) => entry.nodeId === row.entry.nodeId);
    const entry = row.entry;
    const open = () =>
      entry.kind === 'ALBUM' ? onToggleAlbum(entry) : onSelectDocument(entry.documentId, row.parentAlbumId);
    return [
      { id: 'open', label: labels.sidebar.open, icon: entry.kind === 'ALBUM' ? FolderIcon : VideoIcon, onSelect: open },
      ...(entry.kind === 'ALBUM' && entry.childCount > 0
        ? [
            {
              id: 'toggle',
              label: expanded ? labels.collapseAlbum(entry.title) : labels.expandAlbum(entry.title),
              icon: expanded ? ChevronDownIcon : ChevronRightIcon,
              onSelect: () => onToggleAlbum(entry),
            } satisfies ActionMenuAction,
          ]
        : []),
      ...(entry.kind === 'ALBUM'
        ? [
            {
              id: 'new-child-album',
              label: labels.sidebar.newChildAlbum,
              icon: FolderPlusIcon,
              onSelect: () => onCreateAlbum(entry.albumId),
            } satisfies ActionMenuAction,
          ]
        : []),
      {
        id: 'rename',
        label: labels.sidebar.rename,
        icon: PencilIcon,
        onSelect: () =>
          entry.kind === 'ALBUM'
            ? onRenameAlbum(entry.albumId)
            : onRenameDocument(entry.documentId, entry.document.title),
      },
      {
        id: 'move',
        label: labels.sidebar.move,
        icon: FolderInputIcon,
        onSelect: () =>
          onRequestMove({
            kind: entry.kind,
            id: entry.kind === 'ALBUM' ? entry.albumId : entry.documentId,
            title: entry.kind === 'ALBUM' ? entry.title : entry.document.displayTitle,
            currentAlbumId: row.parentAlbumId,
          }),
      },
      {
        id: 'move-up',
        label: labels.sidebar.moveUp,
        icon: ArrowUpIcon,
        disabled: index <= 0,
        onSelect: () => reorderByStep(row, -1),
      },
      {
        id: 'move-down',
        label: labels.sidebar.moveDown,
        icon: ArrowDownIcon,
        disabled: index < 0 || index >= siblings.length - 1,
        onSelect: () => reorderByStep(row, 1),
      },
    ];
  }

  return (
    <nav
      className={cn(compact ? 'flex flex-col items-center gap-2 px-2 pb-14 pt-3' : 'px-2 py-2')}
      aria-label={labels.collections}
    >
      {placedEntries.map(({ row, branchTopology, ancestorRails }) => {
        const { entry } = row;
        const expanded = entry.kind === 'ALBUM' && expandedAlbumIds.has(entry.albumId);
        const Row = compact ? CompactNavigationEntryRow : NavigationEntryRow;
        return (
          <Row
            key={entry.nodeId}
            row={row}
            branchTopology={branchTopology}
            ancestorRails={ancestorRails}
            selected={entry.kind === 'DOCUMENT' && selectedDocumentId === entry.documentId}
            expanded={expanded}
            childPage={entry.kind === 'ALBUM' ? children[entry.albumId] : undefined}
            dragging={drag?.entry.nodeId === entry.nodeId}
            actions={entryActions(row, expanded)}
            onToggleAlbum={() => entry.kind === 'ALBUM' && onToggleAlbum(entry)}
            onGestureExpand={() => entry.kind === 'ALBUM' && onGestureExpand(entry)}
            onPointerTrackStart={(clientY) => entry.kind === 'ALBUM' && onPointerTrackStart(entry.albumId, clientY)}
            onPointerTrack={(clientY) => (entry.kind === 'ALBUM' ? onPointerTrack(entry.albumId, clientY) : false)}
            onOpenDocument={() => entry.kind === 'DOCUMENT' && onSelectDocument(entry.documentId, row.parentAlbumId)}
            onDragStart={() => setDrag({ entry, parentAlbumId: row.parentAlbumId })}
            onDragEnd={() => {
              endCreationTreeDrag();
              setDrag(null);
            }}
            onDragOver={(event) => dragOverRow(row, event, compact)}
            onDrop={(event) => void dropOnRow(row, event, compact)}
            onLoadMore={() => entry.kind === 'ALBUM' && onLoadChildrenMore(entry.albumId)}
          />
        );
      })}
      {root.nextCursor && (
        <div className={cn('p-3', compact && 'w-full px-1')}>
          <Button
            type="button"
            variant="outline"
            className={cn('w-full', compact && 'h-7 px-1 text-[10px]')}
            disabled={root.loadingMore}
            onClick={onLoadRootMore}
          >
            {root.loadingMore && <LoaderCircleIcon className="size-4 animate-spin" />}
            {labels.loadMore}
          </Button>
        </div>
      )}
    </nav>
  );
}
