import { ArchiveIcon, FolderInputIcon, PanelsTopLeftIcon, Trash2Icon } from 'lucide-react';
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
import { cn } from '@/renderer/lib/utils';

interface Props extends CreationLibraryTreePlacementProps, CreationLibraryTreeDragProps {
  post: SocialPostDto;
  selected: boolean;
  busy: boolean;
  locale: 'zh' | 'en';
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

function actions({
  post,
  busy,
  locale,
  additionalActions = [],
  onSelect,
  onMove,
  onArchive,
  onDelete,
}: Props): ActionMenuAction[] {
  return [
    {
      id: 'open',
      label: locale === 'zh' ? '打开' : 'Open',
      icon: PanelsTopLeftIcon,
      onSelect: () => onSelect(post.id),
    },
    ...(onMove
      ? [
          {
            id: 'move',
            label: locale === 'zh' ? '移动…' : 'Move…',
            icon: FolderInputIcon,
            disabled: busy,
            onSelect: () => onMove(post),
          } satisfies ActionMenuAction,
        ]
      : []),
    ...additionalActions,
    {
      id: 'archive',
      label: locale === 'zh' ? '归档' : 'Archive',
      icon: ArchiveIcon,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => onArchive(post.id),
    },
    {
      id: 'delete',
      label: locale === 'zh' ? '删除' : 'Delete',
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => onDelete(post.id),
    },
  ];
}

function SocialPostTypeBadge({ locale }: Pick<Props, 'locale'>) {
  const label = locale === 'zh' ? '贴图' : 'Social post';
  return (
    <span
      title={label}
      aria-label={label}
      className="pointer-events-none absolute bottom-0 left-0 z-20 grid size-5 place-items-center rounded-md border bg-overlay/95 text-foreground-secondary shadow-overlay"
    >
      <PanelsTopLeftIcon className="size-3" />
    </span>
  );
}

export function SocialPostLibraryRow(props: Props) {
  const {
    post,
    selected,
    locale,
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
  const menuActions = actions(props);
  const title = post.content.title || (locale === 'zh' ? '未命名贴图' : 'Untitled post');
  const previewItems = post.content.mediaAssets.map((asset) => ({ asset }));
  const previewMetrics = getCreationTreeMediaNodeMetrics(previewItems);
  const row = (
    <CreationLibraryTreeItem
      dataAttributes={{ 'data-social-post-id': post.id, ...dataAttributes }}
      selected={selected}
      branchTopology={branchTopology}
      ariaLabel={`${locale === 'zh' ? '贴图' : 'Social post'}: ${title}`}
      openLabel={`${locale === 'zh' ? '打开' : 'Open'}: ${title}`}
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
          <SocialPostTypeBadge locale={locale} />
        </span>
      }
      controls={
        <div className="pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {onDragStart && (
            <TreeDragHandle
              label={locale === 'zh' ? '拖动贴图' : 'Drag social post'}
              onDragStart={onDragStart}
              onDragEnd={() => onDragEnd?.()}
            />
          )}
          <ActionMenuButton
            actions={menuActions}
            label={`${locale === 'zh' ? '更多操作' : 'More actions'}: ${title}`}
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
  const { post, selected, locale, onSelect, onDragStart, onDragEnd } = props;
  const menuActions = actions(props);
  const title = post.content.title || (locale === 'zh' ? '未命名贴图' : 'Untitled post');
  const previewItems = post.content.mediaAssets.map((asset) => ({ asset }));
  const content = (
    <button
      type="button"
      title={title}
      aria-label={`${locale === 'zh' ? '贴图' : 'Social post'}: ${title}`}
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
      <SocialPostTypeBadge locale={locale} />
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
