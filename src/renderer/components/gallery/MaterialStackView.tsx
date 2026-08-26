import {
  ArchiveIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  Layers3Icon,
  SquarePenIcon,
  Trash2Icon,
  VideoIcon,
} from 'lucide-react';
import { useState, type DragEvent as ReactDragEvent } from 'react';
import type { AssetFileRevealContext } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ActionContextMenuItems, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuIcon,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import {
  stackedMediaFrameLayerClassName,
  stackedMediaFrameLiftClassName,
  stackedMediaFrameStyle,
} from '@/renderer/components/ui/stacked-media-frame';
import { getMaterialCardAspectRatio } from '@/renderer/components/gallery/MaterialCard';
import {
  hasMaterialLifecycleEntity,
  materialTitle,
  selectionModifiers,
  type MaterialLibraryItem,
  type SelectionModifiers,
} from '@/renderer/components/gallery/materialLibraryTypes';
import type { MaterialStack } from '@/renderer/components/gallery/materialStacking';

interface Props {
  stacks: readonly MaterialStack[];
  selectedKey: string | null;
  checkedKeys?: ReadonlySet<string>;
  selectionMode?: boolean;
  selectionAvailable?: boolean;
  onSelect(item: MaterialLibraryItem, modifiers?: SelectionModifiers): void;
  onToggleStackSelection?(items: readonly MaterialLibraryItem[], checked: boolean): void;
  onOpenStack?(stack: MaterialStack): void;
  onCopyText(text: string): void;
  onArchive?(item: MaterialLibraryItem): void;
  onDelete?(item: MaterialLibraryItem): void;
  lifecycleBusy?: boolean;
  notify(message: string): void;
  onDragStart?(event: ReactDragEvent<HTMLElement>, items: readonly MaterialLibraryItem[]): void;
  revealContextForItem?(item: MaterialLibraryItem): AssetFileRevealContext | undefined;
}

const visibleFrameLimit = 4;

function displayTitle(item: MaterialLibraryItem, labels: ReturnType<typeof useI18n>['messages']['gallery']['card']) {
  const fallback =
    item.kind === 'TEXT'
      ? labels.textMaterial
      : item.image.asset.kind === 'GENERATED'
        ? labels.generated
        : labels.reference;
  return materialTitle(item, fallback);
}

function frameSize(item: MaterialLibraryItem, count: number) {
  const maxWidth = count === 1 ? 184 : 126;
  const maxHeight = count === 1 ? 138 : 132;
  const ratio = getMaterialCardAspectRatio(item);
  return ratio >= maxWidth / maxHeight
    ? { width: maxWidth, height: maxWidth / ratio }
    : { width: maxHeight * ratio, height: maxHeight };
}

function StackMedia({ item }: { item: Exclude<MaterialLibraryItem, { kind: 'TEXT' }> }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="grid size-full place-items-center bg-surface-sunken text-muted-foreground">
        {item.kind === 'VIDEO' ? (
          <VideoIcon className="size-7 opacity-50" />
        ) : (
          <ImageIcon className="size-7 opacity-50" />
        )}
      </span>
    );
  }
  return (
    <img
      src={mediaThumbnailUrl(item.image.asset, 320)}
      alt=""
      className="size-full object-contain"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function StackText({ item }: { item: Extract<MaterialLibraryItem, { kind: 'TEXT' }> }) {
  return (
    <span className="flex size-full flex-col bg-surface p-3 text-left">
      <FileTextIcon className="mb-2 size-4 shrink-0 text-muted-foreground" />
      <span className="line-clamp-5 whitespace-pre-wrap break-words text-xs leading-4 text-foreground/80">
        {item.text.text}
      </span>
    </span>
  );
}

function MaterialFrame({
  item,
  index,
  count,
  expanded,
  selected,
  checked,
  label,
  copyLabel,
  onSelect,
  onCopyText,
  onArchive,
  onDelete,
  lifecycleBusy,
  notify,
  revealContext,
}: {
  item: MaterialLibraryItem;
  index: number;
  count: number;
  expanded: boolean;
  selected: boolean;
  checked: boolean;
  label: string;
  copyLabel: string;
  onSelect(item: MaterialLibraryItem, modifiers?: SelectionModifiers): void;
  onCopyText(text: string): void;
  notify(message: string): void;
  revealContext?: AssetFileRevealContext;
  onArchive?(item: MaterialLibraryItem): void;
  onDelete?(item: MaterialLibraryItem): void;
  lifecycleBusy?: boolean;
}) {
  const { messages } = useI18n();
  const offset = index - (count - 1) / 2;
  const step = expanded ? 28 : 10;
  const rotation = expanded || count === 1 ? 0 : offset * 4;
  const size = frameSize(item, count);
  const materialId = item.kind === 'TEXT' ? item.text.id : item.image.materialId;
  const lifecycleAvailable = hasMaterialLifecycleEntity(item);
  const lifecycleActions: ActionMenuAction[] = [
    ...(onArchive && lifecycleAvailable
      ? [
          {
            id: 'archive-material',
            label: messages.contentManagement.actions.archive,
            icon: ArchiveIcon,
            disabled: lifecycleBusy,
            onSelect: () => onArchive(item),
          } satisfies ActionMenuAction,
        ]
      : []),
    ...(onDelete && lifecycleAvailable
      ? [
          {
            id: 'delete-material',
            label: messages.contentManagement.actions.delete,
            icon: Trash2Icon,
            destructive: true,
            disabled: lifecycleBusy,
            onSelect: () => onDelete(item),
          } satisfies ActionMenuAction,
        ]
      : []),
  ];
  const style = stackedMediaFrameStyle(count - index, {
    left: '50%',
    top: '50%',
    width: size.width,
    height: size.height,
    transform: `translate(calc(-50% + ${offset * step}px), -50%) rotate(${rotation}deg)`,
  });
  const button = (
    <button
      type="button"
      data-action="material-open-inspector"
      data-material-key={item.key}
      data-material-id={materialId ?? undefined}
      aria-label={label}
      aria-pressed={selected || checked}
      className={cn(
        'absolute overflow-hidden rounded-lg border border-border/80 bg-surface-sunken text-left outline-none transition-[transform,border-color] duration-fast ease-out focus-visible:ring-2 focus-visible:ring-ring',
        stackedMediaFrameLayerClassName,
        stackedMediaFrameLiftClassName,
        selected && 'border-selected-border ring-2 ring-ring',
        checked && 'border-selected-border ring-2 ring-ring',
      )}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item, selectionModifiers(event));
      }}
    >
      {item.kind === 'TEXT' ? <StackText item={item} /> : <StackMedia item={item} />}
    </button>
  );

  if (item.kind !== 'TEXT') {
    return (
      <AssetFileContextMenu
        assetId={item.image.asset.id}
        notify={notify}
        revealContext={revealContext}
        copyable={item.kind !== 'VIDEO'}
        usableInCreation={item.kind !== 'VIDEO'}
        lifecycleActions={onArchive || onDelete ? lifecycleActions : undefined}
      >
        {button}
      </AssetFileContextMenu>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onCopyText(item.text.text)}>
          <ContextMenuIcon>
            <CopyIcon />
          </ContextMenuIcon>
          {copyLabel}
        </ContextMenuItem>
        {lifecycleActions.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ActionContextMenuItems actions={lifecycleActions} />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function StackIcon({ stack, first }: { stack: MaterialStack; first: MaterialLibraryItem }) {
  if (stack.target?.kind === 'CREATION') return <SquarePenIcon className="size-3.5" />;
  if (stack.target?.kind === 'ALBUM') return <Layers3Icon className="size-3.5" />;
  if (first.kind === 'TEXT') return <FileTextIcon className="size-3.5" />;
  if (first.kind === 'VIDEO') return <VideoIcon className="size-3.5" />;
  return <ImageIcon className="size-3.5" />;
}

function MaterialStackTile({
  stack,
  selectedKey,
  checkedKeys,
  selectionMode,
  selectionAvailable,
  onSelect,
  onToggleStackSelection,
  onOpenStack,
  onCopyText,
  onArchive,
  onDelete,
  lifecycleBusy,
  notify,
  onDragStart,
  revealContextForItem,
}: Omit<Props, 'stacks'> & { stack: MaterialStack }) {
  const { messages } = useI18n();
  const cardLabels = messages.gallery.card;
  const [expanded, setExpanded] = useState(false);
  const first = stack.items[0];
  const title = stack.title ?? displayTitle(first, cardLabels);
  const visible = stack.items.slice(0, visibleFrameLimit);
  const selected = stack.items.some((item) => item.key === selectedKey);
  const checkedCount = stack.items.filter((item) => checkedKeys?.has(item.key)).length;
  const allChecked = checkedCount === stack.items.length;
  const someChecked = checkedCount > 0 && !allChecked;
  const openLabel = stack.target ? `${messages.gallery.albums.open}: ${title}` : cardLabels.select(title);

  function activateStack() {
    if (selectionMode && selectionAvailable && onToggleStackSelection) {
      onToggleStackSelection(stack.items, !allChecked);
      return;
    }
    if (stack.target && onOpenStack) onOpenStack(stack);
    else onSelect(first);
  }

  return (
    <article
      data-material-stack={stack.key}
      data-material-stack-count={stack.items.length}
      data-material-stack-target={stack.target?.kind ?? 'MATERIAL'}
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => onDragStart?.(event, stack.items)}
      className={cn(
        'group/stack relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface transition-colors hover:border-border-strong focus-within:border-border-strong',
        selected && 'border-selected-border ring-1 ring-ring',
        checkedCount > 0 && 'border-selected-border ring-1 ring-ring',
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
    >
      <div className="relative h-44 min-w-0 overflow-hidden bg-surface-sunken/35">
        {visible.map((item, index) => (
          <MaterialFrame
            key={item.key}
            item={item}
            index={index}
            count={visible.length}
            expanded={expanded}
            selected={item.key === selectedKey}
            checked={checkedKeys?.has(item.key) ?? false}
            label={cardLabels.select(displayTitle(item, cardLabels))}
            copyLabel={cardLabels.copyText}
            onSelect={onSelect}
            onCopyText={onCopyText}
            onArchive={onArchive}
            onDelete={onDelete}
            lifecycleBusy={lifecycleBusy}
            notify={notify}
            revealContext={revealContextForItem?.(item)}
          />
        ))}
        {stack.items.length > visible.length && (
          <span className="absolute bottom-2 right-2 z-30 rounded-full border bg-overlay/95 px-2 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur-sm">
            +{stack.items.length - visible.length}
          </span>
        )}
      </div>

      <button
        type="button"
        className="flex min-h-12 min-w-0 items-center gap-2 border-t px-3 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={openLabel}
        onClick={activateStack}
      >
        <span className="shrink-0 text-muted-foreground">
          <StackIcon stack={stack} first={first} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{stack.items.length}</span>
      </button>

      {selectionAvailable && (
        <span
          className={cn(
            'absolute right-2 top-2 z-40 grid size-7 place-items-center rounded-full border bg-overlay/95 opacity-0 backdrop-blur-sm transition-opacity group-hover/stack:opacity-100 group-focus-within/stack:opacity-100',
            (selectionMode || checkedCount > 0) && 'opacity-100',
          )}
        >
          <Checkbox
            checked={someChecked ? 'indeterminate' : allChecked}
            aria-label={cardLabels.select(title)}
            onCheckedChange={(value) => onToggleStackSelection?.(stack.items, value === true)}
          />
        </span>
      )}
    </article>
  );
}

export function MaterialStackView({ stacks, ...props }: Props) {
  return (
    <div
      data-material-stack-view
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] items-start gap-4"
    >
      {stacks.map((stack) => (
        <MaterialStackTile key={stack.key} stack={stack} {...props} />
      ))}
    </div>
  );
}
