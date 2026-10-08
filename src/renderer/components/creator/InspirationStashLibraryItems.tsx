import { ArchiveIcon, BookmarkIcon, FolderInputIcon, Trash2Icon } from 'lucide-react';
import type { InspirationStashDto } from '@/shared/contracts';
import { itemDragStart } from '@/renderer/components/albums/itemDrag';
import {
  CreationLibraryTreeItem,
  type CreationLibraryTreeDataAttributes,
  type CreationLibraryTreeDragProps,
  type CreationLibraryTreePlacementProps,
  type CreationTreeChildBranch,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { ItemActions, itemActionButtonClassName } from '@/renderer/components/ui/item-actions';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { cn } from '@/renderer/lib/utils';

interface Labels {
  open: string;
  move: string;
  archive: string;
  delete: string;
  moreActions: string;
  category: string;
  toggle: string;
}

interface ItemProps extends CreationLibraryTreePlacementProps, CreationLibraryTreeDragProps {
  stash: InspirationStashDto;
  selected: boolean;
  busy: boolean;
  labels: Labels;
  contained?: boolean;
  dataAttributes?: CreationLibraryTreeDataAttributes;
  childBranch?: CreationTreeChildBranch;
  additionalActions?: readonly ActionMenuAction[];
  onGestureExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
  batchSelection?: {
    checked: boolean;
    label: string;
    onCheckedChange(stashId: string, checked: boolean): void;
  };
  onSelect(stashId: string): void;
  onMove?(stash: InspirationStashDto): void;
  onArchive(stashId: string): void;
  onDelete(stashId: string): void;
}

function stashActions({
  stash,
  busy,
  labels,
  additionalActions = [],
  onSelect,
  onMove,
  onArchive,
  onDelete,
}: ItemProps): ActionMenuAction[] {
  return [
    {
      id: 'open',
      label: labels.open,
      icon: BookmarkIcon,
      onSelect: () => onSelect(stash.id),
    },
    ...(onMove
      ? [
          {
            id: 'move',
            label: labels.move,
            icon: FolderInputIcon,
            disabled: busy,
            onSelect: () => onMove(stash),
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
      onSelect: () => onArchive(stash.id),
    },
    {
      id: 'delete',
      label: labels.delete,
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => onDelete(stash.id),
    },
  ];
}

export function InspirationStashLibraryRow(props: ItemProps) {
  const {
    stash,
    selected,
    labels,
    contained = false,
    dataAttributes,
    childBranch,
    branchTopology,
    batchSelection,
    onGestureExpand,
    onPointerTrackStart,
    onPointerTrack,
    onSelect,
    onDragStart,
    onDragEnd,
  } = props;
  const actions = stashActions(props);
  const selectionControl = batchSelection ? (
    <Checkbox
      checked={batchSelection.checked}
      className="relative z-20"
      aria-label={`${batchSelection.label}: ${stash.displayTitle || labels.category}`}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={(checked) => batchSelection.onCheckedChange(stash.id, checked === true)}
    />
  ) : null;
  const categoryPreview = (
    <span
      className={cn(
        'relative z-10 grid shrink-0 place-items-center rounded-md border bg-background text-foreground-secondary',
        contained ? 'size-7' : 'size-8',
      )}
      title={labels.category}
    >
      <BookmarkIcon className="size-3.5" />
    </span>
  );
  const controls = (
    <ItemActions data-result-library-row-control>
      <ActionMenuButton
        actions={actions}
        label={`${labels.moreActions}: ${stash.displayTitle || labels.category}`}
        className={itemActionButtonClassName}
      />
    </ItemActions>
  );
  const row =
    !contained || branchTopology ? (
      <CreationLibraryTreeItem
        draggable={!props.busy && Boolean(onDragStart)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        dataAttributes={{ 'data-inspiration-stash-id': stash.id, ...dataAttributes }}
        selected={selected}
        branchTopology={branchTopology}
        childBranch={childBranch}
        ariaLabel={`${labels.category}: ${stash.displayTitle || labels.category}`}
        openLabel={`${labels.open}: ${stash.displayTitle || labels.category}`}
        title={stash.displayTitle || labels.category}
        previewBounds={{ left: 16, top: 14, right: 48, bottom: 46 }}
        previewClassName="justify-center"
        preview={categoryPreview}
        leadingContent={selectionControl}
        controls={controls}
        onGestureExpand={onGestureExpand}
        onPointerTrackStart={onPointerTrackStart}
        onPointerTrack={onPointerTrack}
        onOpen={() => onSelect(stash.id)}
      />
    ) : (
      <div
        {...dataAttributes}
        draggable={!props.busy && Boolean(onDragStart)}
        onDragStart={onDragStart && itemDragStart(onDragStart)}
        onDragEnd={onDragEnd}
        data-inspiration-stash-id={stash.id}
        data-result-library-selected={selected ? 'true' : undefined}
        role="group"
        aria-label={`${labels.category}: ${stash.displayTitle || labels.category}`}
        className={cn(
          'group/item relative flex min-w-0 cursor-pointer items-center gap-2 rounded-sm transition-colors hover:bg-hover',
          contained ? 'h-10 pl-8 pr-1' : 'h-12 px-2',
          selected && 'bg-selected text-selected-foreground hover:bg-selected',
          batchSelection?.checked && !selected && 'bg-hover-strong',
        )}
      >
        <button
          type="button"
          aria-label={`${labels.open}: ${stash.displayTitle || labels.category}`}
          aria-current={selected ? 'page' : undefined}
          className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onSelect(stash.id)}
        />
        {selectionControl}
        {categoryPreview}
        <span className="pointer-events-none relative z-10 min-w-0 flex-1 truncate text-sm font-medium">
          {stash.displayTitle || labels.category}
        </span>
        {controls}
      </div>
    );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function InspirationStashCompactItem(props: ItemProps) {
  const { stash, selected, labels, onSelect, onDragStart, onDragEnd } = props;
  const actions = stashActions(props);
  const content = (
    <button
      type="button"
      title={`${labels.category}: ${stash.displayTitle || labels.category}`}
      aria-label={`${labels.category}: ${stash.displayTitle || labels.category}`}
      aria-current={selected ? 'page' : undefined}
      data-result-library-selected={selected ? 'true' : undefined}
      draggable={Boolean(onDragStart)}
      className={cn(
        'relative grid size-16 shrink-0 place-items-center overflow-visible rounded-xl border border-border/70 bg-background text-foreground-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected &&
          'after:pointer-events-none after:absolute after:top-1/2 after:-left-1 after:h-6 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-selected-foreground',
      )}
      onClick={() => onSelect(stash.id)}
      onDragStart={onDragStart}
      onDragEnd={() => onDragEnd?.()}
    >
      <BookmarkIcon className="size-5" />
    </button>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function InspirationStashSessionToggle({
  count,
  expanded,
  hidden = false,
  label,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  hidden?: boolean;
  label: string;
  onToggle(): void;
}) {
  if (hidden || count === 0) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="relative z-30 h-6 shrink-0 gap-1 px-1.5 text-2xs text-foreground-secondary"
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <BookmarkIcon className="size-3" />
      {count}
    </Button>
  );
}
