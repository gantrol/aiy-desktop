import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FolderInputIcon,
  ImagesIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { AlbumDto, MaterialSelectionTargetInput, SidebarRootOrderTargetInput } from '@/shared/contracts';
import type { GalleryDictionaryCollection } from '@/renderer/components/app/app-navigation';
import { cn } from '@/renderer/lib/utils';
import {
  ALBUM_DRAG_TYPE,
  hasExternalFilesDrag,
  hasMaterialsDrag,
  readMaterialsDrag,
  writeAlbumDrag,
} from '@/renderer/components/albums/albumDrag';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { createAlbumExpansionAction } from '@/renderer/components/albums/albumTreeMenuActions';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import {
  TreeBranchCollapseRail,
  TreeBranchCollapseProvider,
  TreeBranchContent,
  TreeBranchTransitRail,
  TreeDisclosureRail,
} from '@/renderer/components/albums/TreeDisclosureRail';
import {
  getTreeBranchItemTopology,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { useAlbumTreeExpansion } from '@/renderer/components/albums/useAlbumTreeExpansion';
import { useDeferredSingleDoubleClick } from '@/renderer/components/albums/useDeferredSingleDoubleClick';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { AlbumNavigationDialogs } from '@/renderer/components/gallery/AlbumNavigationDialogs';
import { AlbumNavigationSurfaceTabs } from '@/renderer/components/gallery/AlbumNavigationSurfaceTabs';
import { DictionaryNavigationPane } from '@/renderer/components/gallery/DictionaryNavigationPane';
import type { DictionaryMaterialTree } from '@/renderer/components/gallery/dictionaryMaterialTree';

export interface AlbumNavigationLabels {
  material?: string;
  dictionary?: string;
  allMaterials: string;
  albums: string;
  archived: string;
  expand: string;
  collapse: string;
  create: string;
  createTitle: string;
  createChild: string;
  rename: string;
  renameTitle: string;
  open: string;
  delete: string;
  deleteTitle: string;
  deleteDescription(title: string): string;
  pin: string;
  unpin: string;
  archive: string;
  restore: string;
  move: string;
  moveTitle: string;
  moveUp: string;
  moveDown: string;
  moveToRoot: string;
  moreActions(title: string): string;
  name: string;
  namePlaceholder: string;
  cancel: string;
  save: string;
  confirmDelete: string;
  belongsTo(title: string): string;
  empty: string;
  operationFailed: string;
}

interface Props {
  albums: AlbumDto[];
  surface: AlbumNavigationSurface;
  activeAlbumId: string | null;
  dictionarySelection: GalleryDictionaryCollection | null;
  dictionaryTree: DictionaryMaterialTree;
  dictionaryMoreLabel: string;
  labels: AlbumNavigationLabels;
  busy?: boolean;
  onSelectSurface(surface: AlbumNavigationSurface): void;
  onSelect(albumId: string | null): void;
  onSelectDictionary(collection: GalleryDictionaryCollection): void;
  onCreate(title: string, parentAlbumId: string | null): Promise<void>;
  onRename(album: AlbumDto, title: string): Promise<void>;
  onDelete(album: AlbumDto): Promise<void>;
  onTogglePin(album: AlbumDto): Promise<void>;
  onSetArchived(album: AlbumDto, archived: boolean): Promise<void>;
  onMove(albumId: string, parentAlbumId: string | null): Promise<void>;
  onReorder(albumId: string, memberIds: string[]): Promise<void>;
  onReorderRoot(targets: SidebarRootOrderTargetInput[]): Promise<void>;
  onCollectMaterials?(albumId: string, targets: MaterialSelectionTargetInput[]): Promise<void>;
  onImportFiles?(album: AlbumDto, files: File[]): void;
}

export type AlbumNavigationSurface = 'MATERIAL' | 'DICTIONARY';

export type AlbumEditorState =
  { mode: 'create'; album: null; parent: AlbumDto | null } | { mode: 'rename'; album: AlbumDto; parent: null };

export function AlbumNavigation({
  albums,
  surface,
  activeAlbumId,
  dictionarySelection,
  dictionaryTree,
  dictionaryMoreLabel,
  labels,
  busy = false,
  onSelectSurface,
  onSelect,
  onSelectDictionary,
  onCreate,
  onRename,
  onDelete,
  onTogglePin,
  onSetArchived,
  onMove,
  onReorder,
  onReorderRoot,
  onCollectMaterials,
  onImportFiles,
}: Props) {
  const [pendingAlbumParents, setPendingAlbumParents] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const [pendingMemberOrders, setPendingMemberOrders] = useState<ReadonlyMap<string, readonly string[]>>(
    () => new Map(),
  );
  const [pendingRootTargets, setPendingRootTargets] = useState<readonly SidebarRootOrderTargetInput[] | null>(null);
  const displayedAlbums = useMemo(() => {
    const rootOrderById = new Map(
      (pendingRootTargets ?? []).flatMap((target, index) =>
        target.targetType === 'ALBUM' ? [[target.targetId, index] as const] : [],
      ),
    );
    return albums.map((album) => {
      const pendingMemberOrder = pendingMemberOrders.get(album.id);
      const memberOrderById = new Map(pendingMemberOrder?.map((memberId, index) => [memberId, index] as const));
      const pendingRootOrder = rootOrderById.get(album.id);
      if (!pendingMemberOrder && pendingRootOrder == null) return album;
      return {
        ...album,
        galleryRootSortOrder: pendingRootOrder ?? album.galleryRootSortOrder,
        members: pendingMemberOrder
          ? album.members.map((member) => ({
              ...member,
              sortOrder: memberOrderById.get(member.id) ?? member.sortOrder,
            }))
          : album.members,
      };
    });
  }, [albums, pendingMemberOrders, pendingRootTargets]);
  const tree = useMemo(
    () => buildAlbumTreeIndex(displayedAlbums, pendingAlbumParents, 'gallery'),
    [displayedAlbums, pendingAlbumParents],
  );
  const albumClick = useDeferredSingleDoubleClick();
  const [editor, setEditor] = useState<AlbumEditorState | null>(null);
  const [deleteAlbum, setDeleteAlbum] = useState<AlbumDto | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const albumViewportRef = useRef<HTMLDivElement>(null);
  const albumExpansion = useAlbumTreeExpansion(albumViewportRef);
  const [dropAlbumId, setDropAlbumId] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const [draggedAlbumId, setDraggedAlbumId] = useState<string | null>(null);
  const [dropPlacement, setDropPlacement] = useState<{
    parentAlbumId: string | null;
    targetAlbumId: string;
    edge: 'before' | 'after';
  } | null>(null);
  const [moveAlbumTarget, setMoveAlbumTarget] = useState<AlbumDto | null>(null);

  function setExpanded(albumId: string, open: boolean) {
    albumExpansion.setPersistent(albumId, open);
  }

  function setHoverExpanded(albumId: string, open: boolean) {
    albumExpansion.setHover(albumId, open);
  }

  function eventAlbumId(event: DragEvent) {
    return draggedAlbumId || event.dataTransfer.getData(ALBUM_DRAG_TYPE) || null;
  }

  function wouldCreateCycle(albumId: string, parentAlbumId: string) {
    const visited = new Set<string>();
    let currentId: string | undefined = parentAlbumId;
    while (currentId && !visited.has(currentId)) {
      if (currentId === albumId) return true;
      visited.add(currentId);
      currentId = tree.parentById.get(currentId);
    }
    return false;
  }

  function supportsDrop(event: DragEvent, allowMaterials: boolean, targetAlbumId?: string) {
    if (allowMaterials && hasMaterialsDrag(event.dataTransfer)) return true;
    if (allowMaterials && onImportFiles && hasExternalFilesDrag(event.dataTransfer)) return true;
    const albumId = eventAlbumId(event);
    if (!albumId || !event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)) return false;
    return !targetAlbumId || (albumId !== targetAlbumId && !wouldCreateCycle(albumId, targetAlbumId));
  }

  async function requestAlbumMove(albumId: string, parentAlbumId: string | null) {
    const currentParentId = tree.parentById.get(albumId) ?? null;
    if (currentParentId === parentAlbumId || (parentAlbumId && wouldCreateCycle(albumId, parentAlbumId))) return;
    setPendingAlbumParents((current) => {
      const next = new Map(current);
      next.set(albumId, parentAlbumId);
      return next;
    });
    try {
      await onMove(albumId, parentAlbumId);
    } finally {
      setPendingAlbumParents((current) => {
        if (!current.has(albumId) || current.get(albumId) !== parentAlbumId) return current;
        const next = new Map(current);
        next.delete(albumId);
        return next;
      });
    }
  }

  async function requestMemberReorder(albumId: string, memberIds: readonly string[]) {
    const nextOrder = [...memberIds];
    setPendingMemberOrders((current) => {
      const next = new Map(current);
      next.set(albumId, nextOrder);
      return next;
    });
    try {
      await onReorder(albumId, nextOrder);
    } finally {
      setPendingMemberOrders((current) => {
        const pending = current.get(albumId);
        if (!pending || pending.length !== nextOrder.length || pending.some((id, index) => id !== nextOrder[index])) {
          return current;
        }
        const next = new Map(current);
        next.delete(albumId);
        return next;
      });
    }
  }

  async function requestRootReorder(targets: readonly SidebarRootOrderTargetInput[]) {
    const nextTargets = [...targets];
    setPendingRootTargets(nextTargets);
    try {
      await onReorderRoot(nextTargets);
    } finally {
      setPendingRootTargets((current) => {
        if (
          !current ||
          current.length !== nextTargets.length ||
          current.some(
            (target, index) =>
              target.targetType !== nextTargets[index]?.targetType || target.targetId !== nextTargets[index]?.targetId,
          )
        ) {
          return current;
        }
        return null;
      });
    }
  }

  function clearDragState() {
    setDraggedAlbumId(null);
    setDropAlbumId(null);
    setDropPlacement(null);
    setRootDropActive(false);
  }

  function startAlbumDrag(event: DragEvent, albumId: string) {
    event.stopPropagation();
    setDraggedAlbumId(albumId);
    writeAlbumDrag(event.dataTransfer, albumId);
  }

  function canDropAtRoot(event: DragEvent) {
    const albumId = eventAlbumId(event);
    return Boolean(albumId && tree.parentById.has(albumId));
  }

  function orderedMemberIds(album: AlbumDto) {
    return [...album.members]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .map((member) => member.id);
  }

  function childAlbumMemberId(parent: AlbumDto, childAlbumId: string) {
    return parent.members.find((member) => member.targetType === 'ALBUM' && member.targetId === childAlbumId)?.id;
  }

  async function reorderAlbumRelativeTo(
    parent: AlbumDto,
    movingAlbumId: string,
    targetAlbumId: string,
    edge: 'before' | 'after',
  ) {
    if (movingAlbumId === targetAlbumId || tree.parentById.get(movingAlbumId) !== parent.id) return;
    const movingMemberId = childAlbumMemberId(parent, movingAlbumId);
    const targetMemberId = childAlbumMemberId(parent, targetAlbumId);
    if (!movingMemberId || !targetMemberId) return;
    const currentOrder = orderedMemberIds(parent);
    const nextOrder = currentOrder.filter((memberId) => memberId !== movingMemberId);
    const targetIndex = nextOrder.indexOf(targetMemberId);
    if (targetIndex < 0) return;
    nextOrder.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, movingMemberId);
    if (nextOrder.every((memberId, index) => memberId === currentOrder[index])) return;
    await requestMemberReorder(parent.id, nextOrder);
  }

  async function reorderRootAlbumRelativeTo(movingAlbumId: string, targetAlbumId: string, edge: 'before' | 'after') {
    const movingAlbum = tree.byId.get(movingAlbumId);
    const targetAlbum = tree.byId.get(targetAlbumId);
    if (
      !movingAlbum ||
      !targetAlbum ||
      movingAlbumId === targetAlbumId ||
      tree.parentById.has(movingAlbumId) ||
      tree.parentById.has(targetAlbumId) ||
      movingAlbum.pinned !== targetAlbum.pinned
    )
      return;
    const current = tree.activeRoots.map((album) => ({ targetType: 'ALBUM' as const, targetId: album.id }));
    const movingIndex = current.findIndex((target) => target.targetId === movingAlbumId);
    if (movingIndex < 0) return;
    const [moving] = current.splice(movingIndex, 1);
    const targetIndex = current.findIndex((target) => target.targetId === targetAlbumId);
    if (targetIndex < 0) return;
    current.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, moving);
    await requestRootReorder(current);
  }

  async function reorderAlbumByStep(parent: AlbumDto, album: AlbumDto, archivedBranch: boolean, direction: -1 | 1) {
    const siblings = (tree.childrenByParentId.get(parent.id) ?? []).filter(
      (child) => tree.effectivelyArchived.has(child.id) === archivedBranch && child.pinned === album.pinned,
    );
    const index = siblings.findIndex((sibling) => sibling.id === album.id);
    const target = siblings[index + direction];
    if (!target) return;
    await reorderAlbumRelativeTo(parent, album.id, target.id, direction < 0 ? 'before' : 'after');
  }

  async function reorderRootAlbumByStep(album: AlbumDto, direction: -1 | 1) {
    const siblings = tree.activeRoots.filter((candidate) => candidate.pinned === album.pinned);
    const index = siblings.findIndex((candidate) => candidate.id === album.id);
    const target = siblings[index + direction];
    if (!target) return;
    await reorderRootAlbumRelativeTo(album.id, target.id, direction < 0 ? 'before' : 'after');
  }

  function reorderEdge(event: DragEvent, album: AlbumDto, parent: AlbumDto | null, archivedBranch: boolean) {
    if (archivedBranch) return null;
    const movingAlbumId = eventAlbumId(event);
    if (!movingAlbumId || movingAlbumId === album.id) return null;
    if (parent) {
      if (tree.parentById.get(movingAlbumId) !== parent.id) return null;
    } else {
      const movingAlbum = tree.byId.get(movingAlbumId);
      if (tree.parentById.has(movingAlbumId) || !movingAlbum || movingAlbum.pinned !== album.pinned) return null;
    }
    if (tree.parentById.get(album.id) !== parent?.id) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
    if (position < 0.3) return 'before' as const;
    if (position > 0.7) return 'after' as const;
    return null;
  }

  function updateDropFeedback(event: DragEvent, album: AlbumDto, parent: AlbumDto | null, archivedBranch: boolean) {
    if (archivedBranch) return false;
    if (!supportsDrop(event, Boolean(onCollectMaterials), album.id)) {
      if (event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)) {
        setDropAlbumId(null);
        setDropPlacement(null);
      }
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const edge = event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)
      ? reorderEdge(event, album, parent, archivedBranch)
      : null;
    if (edge) {
      setDropAlbumId(null);
      setDropPlacement({ parentAlbumId: parent?.id ?? null, targetAlbumId: album.id, edge });
    } else {
      setDropPlacement(null);
      setDropAlbumId(album.id);
    }
    return true;
  }

  async function dropOnAlbum(event: DragEvent, album: AlbumDto, parent: AlbumDto | null, archivedBranch: boolean) {
    event.preventDefault();
    event.stopPropagation();
    const draggedAlbumId = event.dataTransfer.getData(ALBUM_DRAG_TYPE);
    const edge = draggedAlbumId ? reorderEdge(event, album, parent, archivedBranch) : null;
    if (draggedAlbumId && edge) {
      clearDragState();
      if (parent) await reorderAlbumRelativeTo(parent, draggedAlbumId, album.id, edge);
      else await reorderRootAlbumRelativeTo(draggedAlbumId, album.id, edge);
      return;
    }
    setDropAlbumId(null);
    setDropPlacement(null);
    if (draggedAlbumId) {
      if (supportsDrop(event, false, album.id)) await requestAlbumMove(draggedAlbumId, album.id);
      clearDragState();
      return;
    }
    const targets = readMaterialsDrag(event.dataTransfer);
    if (targets.length) {
      await onCollectMaterials?.(album.id, targets);
      return;
    }
    if (onImportFiles && hasExternalFilesDrag(event.dataTransfer)) {
      const files = [...event.dataTransfer.files];
      if (files.length) onImportFiles(album, files);
    }
  }

  function albumReorderActions(parent: AlbumDto | null, album: AlbumDto, archivedBranch: boolean): ActionMenuAction[] {
    const siblings = parent
      ? (tree.childrenByParentId.get(parent.id) ?? []).filter(
          (child) => tree.effectivelyArchived.has(child.id) === archivedBranch && child.pinned === album.pinned,
        )
      : tree.activeRoots.filter((child) => child.pinned === album.pinned);
    if (siblings.length <= 1) return [];
    const siblingIndex = siblings.findIndex((sibling) => sibling.id === album.id);
    return [
      {
        id: 'move-up',
        label: labels.moveUp,
        icon: ArrowUpIcon,
        disabled: busy || archivedBranch || siblingIndex <= 0,
        onSelect: () =>
          void (
            parent ? reorderAlbumByStep(parent, album, archivedBranch, -1) : reorderRootAlbumByStep(album, -1)
          ).catch(() => undefined),
      },
      {
        id: 'move-down',
        label: labels.moveDown,
        icon: ArrowDownIcon,
        disabled: busy || archivedBranch || siblingIndex < 0 || siblingIndex >= siblings.length - 1,
        onSelect: () =>
          void (parent ? reorderAlbumByStep(parent, album, archivedBranch, 1) : reorderRootAlbumByStep(album, 1)).catch(
            () => undefined,
          ),
      },
    ];
  }

  function renderBranch(
    album: AlbumDto,
    archivedBranch: boolean,
    branchTopology?: TreeBranchItemTopology,
    parent: AlbumDto | null = null,
  ): ReactNode {
    const children = (tree.childrenByParentId.get(album.id) ?? []).filter(
      (child) => tree.effectivelyArchived.has(child.id) === archivedBranch,
    );
    const expanded = albumExpansion.isOpen(album.id);
    const ownArchived = Boolean(album.archivedAt);
    const actions: ActionMenuAction[] = [
      { id: 'open', label: labels.open, icon: ImagesIcon, onSelect: () => onSelect(album.id) },
      ...(children.length > 0
        ? [
            createAlbumExpansionAction({
              expanded,
              expandLabel: labels.expand,
              collapseLabel: labels.collapse,
              onExpandedChange: (open) => setExpanded(album.id, open),
            }),
          ]
        : []),
      {
        id: 'create-child',
        label: labels.createChild,
        icon: PlusIcon,
        disabled: busy || archivedBranch,
        onSelect: () => setEditor({ mode: 'create', album: null, parent: album }),
      },
      {
        id: 'move',
        label: labels.move,
        icon: FolderInputIcon,
        disabled: busy || archivedBranch,
        onSelect: () => setMoveAlbumTarget(album),
      },
      ...albumReorderActions(parent, album, archivedBranch),
      {
        id: 'pin',
        label: album.pinned ? labels.unpin : labels.pin,
        icon: album.pinned ? PinOffIcon : PinIcon,
        disabled: busy,
        onSelect: () => void onTogglePin(album),
      },
      ...(ownArchived
        ? [
            {
              id: 'archive',
              label: labels.restore,
              icon: ArchiveRestoreIcon,
              disabled: busy,
              onSelect: () => void onSetArchived(album, false),
            } satisfies ActionMenuAction,
          ]
        : archivedBranch
          ? []
          : [
              {
                id: 'archive',
                label: labels.archive,
                icon: ArchiveIcon,
                disabled: busy,
                onSelect: () => void onSetArchived(album, true),
              } satisfies ActionMenuAction,
            ]),
      {
        id: 'rename',
        label: labels.rename,
        icon: PencilIcon,
        disabled: busy,
        onSelect: () => setEditor({ mode: 'rename', album, parent: null }),
      },
      {
        id: 'delete',
        label: labels.delete,
        icon: Trash2Icon,
        destructive: true,
        separatorBefore: true,
        disabled: busy,
        onSelect: () => setDeleteAlbum(album),
      },
    ];
    const clickHandlers = albumClick.handlers<HTMLButtonElement>(
      () => {
        if (children.length === 0) onSelect(album.id);
        else if (expanded) albumExpansion.collapse(album.id);
        else albumExpansion.setPersistent(album.id, true);
      },
      () => onSelect(album.id),
    );
    const row = (
      <div
        data-album-id={album.id}
        onDragEnter={(event) => {
          updateDropFeedback(event, album, parent, archivedBranch);
        }}
        onDragOver={(event) => {
          if (!updateDropFeedback(event, album, parent, archivedBranch)) {
            if (event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)) event.dataTransfer.dropEffect = 'none';
            return;
          }
          event.dataTransfer.dropEffect =
            hasMaterialsDrag(event.dataTransfer) || hasExternalFilesDrag(event.dataTransfer) ? 'copy' : 'move';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropAlbumId((current) => (current === album.id ? null : current));
            setDropPlacement((current) => (current?.targetAlbumId === album.id ? null : current));
          }
        }}
        onDrop={(event) => void dropOnAlbum(event, album, parent, archivedBranch).catch(() => undefined)}
        className={cn(
          'group relative flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
          activeAlbumId === album.id &&
            'text-selected-foreground before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
          dropAlbumId === album.id && 'bg-accent ring-1 ring-inset ring-ring',
        )}
      >
        {dropPlacement?.targetAlbumId === album.id && (
          <span
            aria-hidden="true"
            data-album-reorder-indicator={dropPlacement.edge}
            className={cn(
              'pointer-events-none absolute inset-x-2 z-40 h-0.5 rounded-full bg-ring',
              dropPlacement.edge === 'before' ? '-top-px' : '-bottom-px',
            )}
          />
        )}
        <AlbumTreePreview
          assets={album.previewAssets}
          title={album.title}
          open={expanded}
          expandable={children.length > 0}
          expandLabel={expanded ? labels.collapse : labels.expand}
          overlayStyle="solid"
          disclosureInteractive={false}
          branchTopology={branchTopology}
          onPullDownExpand={() => setHoverExpanded(album.id, true)}
          onPointerTrackStart={(clientY) => albumExpansion.beginPointerTrack(album.id, clientY)}
          onPointerTrack={(clientY) => albumExpansion.trackPointer(album.id, clientY)}
          onClick={clickHandlers.onClick}
          onDoubleClick={clickHandlers.onDoubleClick}
        />
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'z-10 h-14 min-w-0 flex-1 justify-start border-transparent px-1 font-normal focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-strong',
            activeAlbumId === album.id && 'bg-transparent hover:bg-transparent focus-visible:bg-transparent',
          )}
          {...clickHandlers}
          onKeyDown={(event) => {
            if (!children.length) return;
            if (event.key === 'ArrowRight' && !expanded) {
              event.preventDefault();
              setExpanded(album.id, true);
            } else if (event.key === 'ArrowLeft' && expanded) {
              event.preventDefault();
              setExpanded(album.id, false);
            }
          }}
        >
          <span
            className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-left text-base font-medium leading-5"
            title={album.title}
          >
            {album.title}
          </span>
        </Button>
        {album.pinned && (
          <PinIcon className="relative z-10 size-3.5 shrink-0 text-muted-foreground" aria-label={labels.pin} />
        )}
        <div className="pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {!busy && !archivedBranch && (
            <TreeDragHandle
              label={`${labels.move}: ${album.title}`}
              onDragStart={(event) => startAlbumDrag(event, album.id)}
              onDragEnd={clearDragState}
            />
          )}
          <ActionMenuButton
            actions={actions}
            label={labels.moreActions(album.title)}
            className="pointer-events-auto size-6 bg-overlay/95 shadow-overlay"
          />
        </div>
      </div>
    );

    return (
      <Collapsible
        key={album.id}
        open={expanded}
        onOpenChange={(open) => setExpanded(album.id, open)}
        className="relative"
        data-album-branch-id={album.id}
      >
        {branchTopology && <TreeBranchTransitRail topology={branchTopology} />}
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
        {children.length > 0 && expanded && (
          <TreeBranchCollapseRail label={labels.collapse} onCollapse={() => albumExpansion.collapse(album.id)} />
        )}
        {children.length > 0 && (
          <TreeBranchContent>
            <TreeBranchCollapseProvider onCollapse={() => albumExpansion.collapse(album.id)}>
              {children.map((child, index) =>
                renderBranch(child, archivedBranch, getTreeBranchItemTopology(index, children.length), album),
              )}
            </TreeBranchCollapseProvider>
          </TreeBranchContent>
        )}
      </Collapsible>
    );
  }

  return (
    <aside data-slot="material-library-navigation" className="flex w-64 shrink-0 flex-col border-r bg-muted/25">
      <AlbumNavigationSurfaceTabs value={surface} labels={labels} onChange={onSelectSurface} />

      {surface === 'MATERIAL' ? (
        <>
          <div className="border-b p-2">
            <Button
              type="button"
              data-action="material-all"
              variant={activeAlbumId === null ? 'secondary' : 'ghost'}
              className="h-10 w-full justify-start gap-2 px-2 font-normal focus-visible:bg-hover-strong focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-strong"
              onClick={() => onSelect(null)}
            >
              <ImagesIcon className="size-4" />
              <span className="truncate">{labels.allMaterials}</span>
            </Button>
          </div>

          <div
            className={cn(
              'flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3',
              rootDropActive && 'bg-accent',
            )}
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)) return;
              if (canDropAtRoot(event)) {
                event.preventDefault();
                setRootDropActive(true);
              } else {
                setRootDropActive(false);
              }
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)) return;
              if (canDropAtRoot(event)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              } else {
                event.dataTransfer.dropEffect = 'none';
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRootDropActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const albumId = eventAlbumId(event);
              const eligible = canDropAtRoot(event);
              clearDragState();
              if (albumId && eligible) void requestAlbumMove(albumId, null).catch(() => undefined);
            }}
          >
            <strong className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
              {labels.albums}
            </strong>
            <Button
              type="button"
              data-action="material-create-album"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={labels.create}
              title={labels.create}
              onClick={() => setEditor({ mode: 'create', album: null, parent: null })}
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>

          <ScrollArea type="always" className="min-h-0 flex-1" viewportRef={albumViewportRef}>
            <div className="space-y-0.5 px-2 py-2">
              {tree.activeRoots.map((album) => renderBranch(album, false))}
              {tree.archivedRoots.length > 0 && (
                <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen} className="pt-2">
                  <CollapsibleTrigger asChild>
                    <TreeDisclosureRail
                      open={archivedOpen}
                      label={archivedOpen ? labels.collapse : labels.expand}
                      className="h-8 w-full justify-start px-2 text-xs font-normal text-muted-foreground"
                    >
                      <ArchiveIcon className="size-3.5" />
                      <span className="flex-1 text-left">{labels.archived}</span>
                    </TreeDisclosureRail>
                  </CollapsibleTrigger>
                  <TreeBranchContent className="space-y-0.5 pt-1">
                    {tree.archivedRoots.map((album) => renderBranch(album, true))}
                  </TreeBranchContent>
                </Collapsible>
              )}
            </div>
          </ScrollArea>
        </>
      ) : (
        <DictionaryNavigationPane
          viewportRef={albumViewportRef}
          tree={dictionaryTree}
          selection={dictionarySelection}
          expansion={albumExpansion}
          click={albumClick}
          labels={labels}
          moreLabel={dictionaryMoreLabel}
          onSelect={onSelectDictionary}
        />
      )}

      <AlbumNavigationDialogs
        albums={albums}
        editor={editor}
        deleteAlbum={deleteAlbum}
        moveAlbumTarget={moveAlbumTarget}
        moveCurrentAlbumId={moveAlbumTarget ? (tree.parentById.get(moveAlbumTarget.id) ?? null) : null}
        labels={labels}
        busy={busy}
        onEditorClose={() => setEditor(null)}
        onDeleteClose={() => setDeleteAlbum(null)}
        onMoveClose={() => setMoveAlbumTarget(null)}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={requestAlbumMove}
      />
    </aside>
  );
}
