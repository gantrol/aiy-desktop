import { ArchiveIcon, FileTextIcon, FolderInputIcon, Trash2Icon } from 'lucide-react';
import type { SocialPostDto } from '@/shared/contracts';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import {
  CreationLibraryTreeItem,
  type CreationLibraryTreeDataAttributes,
  type CreationLibraryTreeDragProps,
  type CreationLibraryTreePlacementProps,
  type CreationTreeChildBranch,
  getCreationTreeMediaNodeMetrics,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props extends CreationLibraryTreePlacementProps, CreationLibraryTreeDragProps {
  post: SocialPostDto;
  selected: boolean;
  busy: boolean;
  dataAttributes?: CreationLibraryTreeDataAttributes;
  childBranch?: CreationTreeChildBranch;
  additionalActions?: readonly ActionMenuAction[];
  onGestureExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
  onSelect(postId: string): void;
  onMove?(post: SocialPostDto): void;
  onArchive(postId: string): void;
  onDelete(postId: string): void;
}

interface Labels {
  archive: string;
  delete: string;
  drag: string;
  kind: string;
  moreActions: string;
  move: string;
  open: string;
  untitled: string;
}

function actions(
  { post, busy, additionalActions = [], onSelect, onMove, onArchive, onDelete }: Props,
  labels: Labels,
): ActionMenuAction[] {
  return [
    {
      id: 'open',
      label: labels.open,
      icon: FileTextIcon,
      onSelect: () => onSelect(post.id),
    },
    ...(onMove
      ? [
          {
            id: 'move',
            label: labels.move,
            icon: FolderInputIcon,
            disabled: busy,
            onSelect: () => onMove(post),
          } satisfies ActionMenuAction,
        ]
      : []),
    ...additionalActions,
    {
      id: 'archive',
      label: labels.archive,
      icon: ArchiveIcon,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => onArchive(post.id),
    },
    {
      id: 'delete',
      label: labels.delete,
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => onDelete(post.id),
    },
  ];
}

function SocialPostTypeBadge() {
  const label = useI18n().messages.creator.manuscriptEditor.kind;
  return (
    <span
      title={label}
      aria-label={label}
      className="pointer-events-none absolute bottom-0 left-0 z-20 grid size-5 place-items-center rounded-md border bg-overlay/95 text-foreground-secondary shadow-overlay"
    >
      <FileTextIcon className="size-3" />
    </span>
  );
}

export function SocialPostLibraryRow(props: Props) {
  const {
    post,
    selected,
    dataAttributes,
    childBranch,
    branchTopology,
    onGestureExpand,
    onPointerTrackStart,
    onPointerTrack,
    onSelect,
    onDragStart,
    onDragEnd,
  } = props;
  const { messages } = useI18n();
  const labels: Labels = {
    archive: messages.creator.album.archive,
    delete: messages.creator.album.delete,
    drag: messages.creator.manuscriptEditor.drag,
    kind: messages.creator.manuscriptEditor.kind,
    moreActions: messages.creator.album.moreActions,
    move: messages.creator.album.move,
    open: messages.creator.album.open,
    untitled: messages.creator.manuscriptEditor.untitled,
  };
  const menuActions = actions(props, labels);
  const title = post.content.title || labels.untitled;
  const previewItems = post.content.mediaAssets.map((asset) => ({ asset }));
  const previewMetrics = getCreationTreeMediaNodeMetrics(previewItems);
  const row = (
    <CreationLibraryTreeItem
      dataAttributes={{ 'data-social-post-id': post.id, ...dataAttributes }}
      selected={selected}
      branchTopology={branchTopology}
      ariaLabel={`${labels.kind}: ${title}`}
      openLabel={`${labels.open}: ${title}`}
      title={title}
      childBranch={childBranch}
      previewBounds={previewMetrics.bounds}
      previewStyle={{ width: previewMetrics.width }}
      preview={
        <span className="relative grid h-[3.75rem] w-full place-items-center overflow-visible">
          <MediaStackPreview
            className="pointer-events-none"
            size="tree"
            singleItemAlign="center"
            items={previewItems}
            maxItems={3}
          />
          <SocialPostTypeBadge />
        </span>
      }
      controls={
        <div className="pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {onDragStart && (
            <TreeDragHandle label={labels.drag} onDragStart={onDragStart} onDragEnd={() => onDragEnd?.()} />
          )}
          <ActionMenuButton
            actions={menuActions}
            label={`${labels.moreActions}: ${title}`}
            className="pointer-events-auto size-6 rounded-md bg-overlay/95 shadow-overlay"
          />
        </div>
      }
      onGestureExpand={onGestureExpand}
      onPointerTrackStart={onPointerTrackStart}
      onPointerTrack={onPointerTrack}
      onOpen={() => onSelect(post.id)}
    />
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems actions={menuActions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SocialPostCompactItem(props: Props) {
  const { post, selected, onSelect, onDragStart, onDragEnd } = props;
  const { messages } = useI18n();
  const labels: Labels = {
    archive: messages.creator.album.archive,
    delete: messages.creator.album.delete,
    drag: messages.creator.manuscriptEditor.drag,
    kind: messages.creator.manuscriptEditor.kind,
    moreActions: messages.creator.album.moreActions,
    move: messages.creator.album.move,
    open: messages.creator.album.open,
    untitled: messages.creator.manuscriptEditor.untitled,
  };
  const menuActions = actions(props, labels);
  const title = post.content.title || labels.untitled;
  const previewItems = post.content.mediaAssets.map((asset) => ({ asset }));
  const content = (
    <button
      type="button"
      title={title}
      aria-label={`${labels.kind}: ${title}`}
      aria-current={selected ? 'page' : undefined}
      data-result-library-selected={selected ? 'true' : undefined}
      draggable={Boolean(onDragStart)}
      className={cn(
        'relative grid size-16 shrink-0 place-items-center overflow-visible rounded-xl bg-transparent text-foreground-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected &&
          'after:pointer-events-none after:absolute after:top-1/2 after:-left-1 after:z-30 after:h-6 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-selected-foreground',
      )}
      onClick={() => onSelect(post.id)}
      onDragStart={onDragStart}
      onDragEnd={() => onDragEnd?.()}
    >
      <MediaStackPreview
        className="pointer-events-none"
        size="rail"
        singleItemAlign="center"
        items={previewItems}
        maxItems={3}
      />
      <SocialPostTypeBadge />
    </button>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems actions={menuActions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
