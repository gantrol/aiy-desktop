import { FolderInputIcon, ImagesIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { Dispatch, DragEvent, SetStateAction } from 'react';
import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import { MATERIALS_DRAG_TYPE, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { createAlbumExpansionAction } from '@/renderer/components/albums/albumTreeMenuActions';
import type { useAlbumTreeExpansion } from '@/renderer/components/albums/useAlbumTreeExpansion';
import type {
  DeferredSingleDoubleClickHandlers,
  useDeferredSingleDoubleClick,
} from '@/renderer/components/albums/useDeferredSingleDoubleClick';
import {
  TreeBranchCollapseRail,
  TreeBranchCollapseProvider,
  TreeBranchContent,
  TreeBranchTransitRail,
} from '@/renderer/components/albums/TreeDisclosureRail';
import {
  getTreeBranchItemTopology,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { cn } from '@/renderer/lib/utils';
import type { MaterialAlbumEditorState } from '@/renderer/components/gallery/MaterialAlbumDialogs';
import type { MaterialAlbumTreeIndex } from '@/renderer/components/gallery/materialAlbumTree';

export interface MaterialAlbumBranchLabels {
  open: string;
  expand: string;
  collapse: string;
  createChild: string;
  moveToRoot: string;
  rename: string;
  delete: string;
  moreActions(title: string): string;
}

type Expansion = ReturnType<typeof useAlbumTreeExpansion>;
type DeferredClick = ReturnType<typeof useDeferredSingleDoubleClick>;

function immediateOpenHandlers<Element extends HTMLElement>(
  open: () => void,
): DeferredSingleDoubleClickHandlers<Element> {
  return {
    onClick(event) {
      if (event.detail <= 1) open();
    },
    onDoubleClick() {
      // The first click already opened a leaf. Ignore the synthetic second
      // click so a double click cannot enqueue a duplicate navigation.
    },
  };
}

interface SharedBranchProps {
  album: MaterialAlbumDto;
  tree: MaterialAlbumTreeIndex;
  activeAlbumId: string | null;
  labels: MaterialAlbumBranchLabels;
  expansion: Expansion;
  click: DeferredClick;
  branchTopology?: TreeBranchItemTopology;
  onSelectAlbum(albumId: string): void;
}

interface MaterialAlbumBranchProps extends SharedBranchProps {
  browseOnly?: boolean;
  busy: boolean;
  dropAlbumId: string | null;
  onDropAlbumChange: Dispatch<SetStateAction<string | null>>;
  onEditorChange(state: MaterialAlbumEditorState): void;
  onDeleteAlbumChange(album: MaterialAlbumDto): void;
  onMove?(albumId: string, parentAlbumId: string | null): Promise<void>;
  onCollectMaterials(albumId: string, targets: MaterialSelectionTargetInput[]): Promise<void>;
  onImportFiles?(album: MaterialAlbumDto, files: File[]): void;
}

export function MaterialAlbumBranch(props: MaterialAlbumBranchProps) {
  const {
    album,
    tree,
    activeAlbumId,
    labels,
    browseOnly = false,
    busy,
    dropAlbumId,
    expansion,
    click,
    branchTopology,
    onSelectAlbum,
    onDropAlbumChange,
    onEditorChange,
    onDeleteAlbumChange,
    onMove,
    onCollectMaterials,
    onImportFiles,
  } = props;
  const children = tree.childrenByParentId.get(album.id) ?? [];
  const expanded = expansion.isOpen(album.id);
  const hasParent = Boolean(album.parentId && tree.byId.has(album.parentId));
  const clickHandlers = children.length
    ? click.handlers<HTMLButtonElement>(
        () => {
          if (expanded) expansion.collapse(album.id);
          else expansion.setPersistent(album.id, true);
        },
        () => onSelectAlbum(album.id),
      )
    : immediateOpenHandlers<HTMLButtonElement>(() => onSelectAlbum(album.id));
  const actions: ActionMenuAction[] = [
    { id: 'open', label: labels.open, icon: ImagesIcon, onSelect: () => onSelectAlbum(album.id) },
    ...(children.length > 0
      ? [
          createAlbumExpansionAction({
            expanded,
            expandLabel: labels.expand,
            collapseLabel: labels.collapse,
            onExpandedChange: (open) => expansion.setPersistent(album.id, open),
          }),
        ]
      : []),
    ...(!browseOnly
      ? [
          {
            id: 'create-child',
            label: labels.createChild,
            icon: PlusIcon,
            disabled: busy,
            onSelect: () => onEditorChange({ mode: 'create', parent: album }),
          } satisfies ActionMenuAction,
          ...(hasParent && onMove
            ? [
                {
                  id: 'move-to-root',
                  label: labels.moveToRoot,
                  icon: FolderInputIcon,
                  disabled: busy,
                  onSelect: () => void onMove(album.id, null),
                } satisfies ActionMenuAction,
              ]
            : []),
          {
            id: 'rename',
            label: labels.rename,
            icon: PencilIcon,
            onSelect: () => onEditorChange({ mode: 'rename', album }),
          } satisfies ActionMenuAction,
          {
            id: 'delete',
            label: labels.delete,
            icon: Trash2Icon,
            destructive: true,
            separatorBefore: true,
            onSelect: () => onDeleteAlbumChange(album),
          } satisfies ActionMenuAction,
        ]
      : []),
  ];

  const row = (
    <div
      data-album-id={album.id}
      data-parent-album-id={album.parentId ?? ''}
      data-material-count={album.materialCount}
      data-active={activeAlbumId === album.id ? 'true' : 'false'}
      className={cn(
        'group relative flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
        activeAlbumId === album.id &&
          'text-selected-foreground before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
        dropAlbumId === album.id && 'bg-accent ring-1 ring-inset ring-ring',
      )}
      onDragEnter={(event) => {
        if (browseOnly) return;
        if (
          !event.dataTransfer.types.includes(MATERIALS_DRAG_TYPE) &&
          !(onImportFiles && event.dataTransfer.types.includes('Files'))
        )
          return;
        event.preventDefault();
        onDropAlbumChange(album.id);
      }}
      onDragOver={(event) => {
        if (browseOnly) return;
        if (
          !event.dataTransfer.types.includes(MATERIALS_DRAG_TYPE) &&
          !(onImportFiles && event.dataTransfer.types.includes('Files'))
        )
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (browseOnly) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropAlbumChange(null);
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        if (browseOnly) return;
        const hasMaterials = event.dataTransfer.types.includes(MATERIALS_DRAG_TYPE);
        const hasFiles = Boolean(onImportFiles && event.dataTransfer.types.includes('Files'));
        if (!hasMaterials && !hasFiles) return;
        event.preventDefault();
        if (hasFiles) event.stopPropagation();
        onDropAlbumChange(null);
        if (hasMaterials) {
          const targets = readMaterialsDrag(event.dataTransfer);
          if (targets.length) void onCollectMaterials(album.id, targets).catch(() => undefined);
          return;
        }
        const files = [...event.dataTransfer.files];
        if (files.length) onImportFiles?.(album, files);
      }}
    >
      <AlbumTreePreview
        assets={album.previewAssets}
        title={album.title}
        open={expanded}
        expandable={children.length > 0}
        expandLabel={expanded ? labels.collapse : labels.expand}
        overlayStyle="solid"
        disclosureInteractive={false}
        branchTopology={branchTopology}
        onPullDownExpand={() => expansion.setHover(album.id, true)}
        onPointerTrackStart={(clientY) => expansion.beginPointerTrack(album.id, clientY)}
        onPointerTrack={(clientY) => expansion.trackPointer(album.id, clientY)}
        onClick={clickHandlers.onClick}
        onDoubleClick={clickHandlers.onDoubleClick}
      />
      <Button
        type="button"
        data-action="material-open-album"
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
            expansion.setPersistent(album.id, true);
          } else if (event.key === 'ArrowLeft' && expanded) {
            event.preventDefault();
            expansion.collapse(album.id);
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
      <ActionMenuButton
        actions={actions}
        label={labels.moreActions(album.title)}
        className="absolute right-1 top-1/2 z-30 size-6 -translate-y-1/2 bg-overlay/95 opacity-0 shadow-overlay group-hover:opacity-100 group-focus-within:opacity-100"
      />
    </div>
  );

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(open) => expansion.setPersistent(album.id, open)}
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
        <TreeBranchCollapseRail label={labels.collapse} onCollapse={() => expansion.collapse(album.id)} />
      )}
      {children.length > 0 && (
        <TreeBranchContent>
          <TreeBranchCollapseProvider onCollapse={() => expansion.collapse(album.id)}>
            {children.map((child, index) => (
              <MaterialAlbumBranch
                {...props}
                key={child.id}
                album={child}
                branchTopology={getTreeBranchItemTopology(index, children.length)}
              />
            ))}
          </TreeBranchCollapseProvider>
        </TreeBranchContent>
      )}
    </Collapsible>
  );
}

export function CreationGroupBranch(props: SharedBranchProps) {
  const { album, tree, activeAlbumId, labels, expansion, branchTopology, onSelectAlbum } = props;
  const children = tree.childrenByParentId.get(album.id) ?? [];
  const expanded = expansion.isOpen(album.id);
  const clickHandlers = immediateOpenHandlers<HTMLButtonElement>(() => {
    if (children.length && !expanded) expansion.setPersistent(album.id, true);
    onSelectAlbum(album.id);
  });
  const actions: ActionMenuAction[] = [
    { id: 'open', label: labels.open, icon: ImagesIcon, onSelect: () => onSelectAlbum(album.id) },
    ...(children.length > 0
      ? [
          createAlbumExpansionAction({
            expanded,
            expandLabel: labels.expand,
            collapseLabel: labels.collapse,
            onExpandedChange: (open) => expansion.setPersistent(album.id, open),
          }),
        ]
      : []),
  ];
  const row = (
    <div
      data-album-id={album.id}
      data-parent-album-id={album.parentId ?? ''}
      data-material-count={album.materialCount}
      data-active={activeAlbumId === album.id ? 'true' : 'false'}
      className={cn(
        'group relative flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
        activeAlbumId === album.id &&
          'text-selected-foreground before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
      )}
    >
      <AlbumTreePreview
        assets={album.previewAssets}
        title={album.title}
        open={expanded}
        expandable={children.length > 0}
        expandLabel={expanded ? labels.collapse : labels.expand}
        overlayStyle="solid"
        disclosureInteractive={false}
        branchTopology={branchTopology}
        onPullDownExpand={() => expansion.setHover(album.id, true)}
        onPointerTrackStart={(clientY) => expansion.beginPointerTrack(album.id, clientY)}
        onPointerTrack={(clientY) => expansion.trackPointer(album.id, clientY)}
        onClick={clickHandlers.onClick}
        onDoubleClick={clickHandlers.onDoubleClick}
      />
      <Button
        type="button"
        data-action="material-open-album"
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
            expansion.setPersistent(album.id, true);
          } else if (event.key === 'ArrowLeft' && expanded) {
            event.preventDefault();
            expansion.collapse(album.id);
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
      <ActionMenuButton
        actions={actions}
        label={labels.moreActions(album.title)}
        className="absolute right-1 top-1/2 z-30 size-6 -translate-y-1/2 bg-overlay/95 opacity-0 shadow-overlay group-hover:opacity-100 group-focus-within:opacity-100"
      />
    </div>
  );

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(open) => expansion.setPersistent(album.id, open)}
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
        <TreeBranchCollapseRail label={labels.collapse} onCollapse={() => expansion.collapse(album.id)} />
      )}
      {children.length > 0 && (
        <TreeBranchContent>
          <TreeBranchCollapseProvider onCollapse={() => expansion.collapse(album.id)}>
            {children.map((child, index) => (
              <CreationGroupBranch
                {...props}
                key={child.id}
                album={child}
                branchTopology={getTreeBranchItemTopology(index, children.length)}
              />
            ))}
          </TreeBranchCollapseProvider>
        </TreeBranchContent>
      )}
    </Collapsible>
  );
}
