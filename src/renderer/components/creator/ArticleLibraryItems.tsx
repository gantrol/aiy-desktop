import { ArchiveIcon, FileTextIcon, FolderInputIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { ArticleDto } from '@/shared/contracts';
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
  article: ArticleDto;
  selected: boolean;
  busy: boolean;
  dataAttributes?: CreationLibraryTreeDataAttributes;
  childBranch?: CreationTreeChildBranch;
  additionalActions?: readonly ActionMenuAction[];
  onGestureExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
  onSelect(articleId: string): void;
  onRename(article: ArticleDto): void;
  onMove?(article: ArticleDto): void;
  onArchive(articleId: string): void;
  onDelete(articleId: string): void;
}

interface Labels {
  archive: string;
  delete: string;
  drag: string;
  kind: string;
  moreActions: string;
  move: string;
  open: string;
  rename: string;
  untitled: string;
}

function orderedMedia(article: ArticleDto) {
  const coverId = article.content.coverAssetId;
  return [...article.content.mediaAssets].sort(
    (left, right) => Number(right.id === coverId) - Number(left.id === coverId),
  );
}

function actions(
  { article, busy, additionalActions = [], onSelect, onRename, onMove, onArchive, onDelete }: Props,
  labels: Labels,
): ActionMenuAction[] {
  return [
    {
      id: 'open',
      label: labels.open,
      icon: FileTextIcon,
      onSelect: () => onSelect(article.id),
    },
    {
      id: 'rename',
      label: labels.rename,
      icon: PencilIcon,
      disabled: busy,
      onSelect: () => onRename(article),
    },
    ...(onMove
      ? [
          {
            id: 'move',
            label: labels.move,
            icon: FolderInputIcon,
            disabled: busy,
            onSelect: () => onMove(article),
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
      onSelect: () => onArchive(article.id),
    },
    {
      id: 'delete',
      label: labels.delete,
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => onDelete(article.id),
    },
  ];
}

function ArticleTypeBadge() {
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

export function ArticleLibraryRow(props: Props) {
  const {
    article,
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
    rename: messages.creator.album.rename,
    untitled: messages.creator.manuscriptEditor.untitled,
  };
  const menuActions = actions(props, labels);
  const title = article.content.title || labels.untitled;
  const previewItems = orderedMedia(article).map((asset) => ({ asset }));
  const previewMetrics = getCreationTreeMediaNodeMetrics(previewItems);
  const row = (
    <CreationLibraryTreeItem
      dataAttributes={{ 'data-article-id': article.id, ...dataAttributes }}
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
          <ArticleTypeBadge />
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
      onOpen={() => onSelect(article.id)}
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

export function ArticleCompactItem(props: Props) {
  const { article, selected, onSelect, onDragStart, onDragEnd } = props;
  const { messages } = useI18n();
  const labels: Labels = {
    archive: messages.creator.album.archive,
    delete: messages.creator.album.delete,
    drag: messages.creator.manuscriptEditor.drag,
    kind: messages.creator.manuscriptEditor.kind,
    moreActions: messages.creator.album.moreActions,
    move: messages.creator.album.move,
    open: messages.creator.album.open,
    rename: messages.creator.album.rename,
    untitled: messages.creator.manuscriptEditor.untitled,
  };
  const menuActions = actions(props, labels);
  const title = article.content.title || labels.untitled;
  const previewItems = orderedMedia(article).map((asset) => ({ asset }));
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
      onClick={() => onSelect(article.id)}
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
      <ArticleTypeBadge />
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
