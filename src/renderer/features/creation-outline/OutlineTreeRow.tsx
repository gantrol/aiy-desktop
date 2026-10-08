import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  LayersIcon,
  ArrowUpRightIcon,
  LinkIcon,
} from 'lucide-react';
import type { DragEvent, MouseEvent, KeyboardEvent, Ref } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { ItemActions } from '@/renderer/components/ui/item-actions';
import { itemDragStart } from '@/renderer/components/albums/itemDrag';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { OutlineRow } from '@/renderer/features/creation-outline/outline-tree';
import { OutlineNodePreview } from '@/renderer/features/creation-outline/OutlineNodePreview';
import { OutlineNodeMenu } from '@/renderer/features/creation-outline/OutlineNodeMenu';
import type { OutlineNodeActions } from '@/renderer/features/creation-outline/useOutlineNodeActions';

interface Props {
  row: OutlineRow;
  active: boolean;
  current: boolean;
  path: string;
  expanded: boolean;
  collapsible: boolean;
  selected: boolean;
  focused: boolean;
  drop: boolean;
  busy: boolean;
  organization: { spaceId: string; refresh(): Promise<void>; onError(message: string): void };
  nodeActions: OutlineNodeActions;
  elementRef: Ref<HTMLDivElement>;
  onChoose(event: MouseEvent<HTMLDivElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onToggle(wholeBranch: boolean): void;
  onFocus(): void;
  onOpen(): void;
  onOpenSource?(): void;
  onMove(): void;
  onDragStart(event: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
}
export function OutlineTreeRow({
  row,
  active,
  current,
  path,
  expanded,
  collapsible,
  selected,
  focused,
  drop,
  busy,
  organization,
  nodeActions,
  elementRef,
  ...actions
}: Props) {
  const labels = useI18n().messages.creator.outline;
  const { node, depth } = row;
  const Icon =
    node.kind === 'album'
      ? FolderIcon
      : node.kind === 'creation'
        ? LayersIcon
        : node.kind === 'series'
          ? ImageIcon
          : node.content?.kind === 'image'
            ? ImageIcon
            : node.content?.kind === 'reference'
              ? LinkIcon
              : FileTextIcon;
  const preview = (
    <OutlineNodePreview
      key={node.previewAssetId ?? node.kind}
      assetId={node.previewAssetId}
      active={active}
      icon={Icon}
    />
  );
  return (
    <div
      ref={elementRef}
      role="treeitem"
      aria-level={depth + 1}
      aria-label={node.title + ' · ' + node.label}
      aria-selected={selected}
      aria-current={current ? 'page' : undefined}
      aria-expanded={node.children.length ? expanded : undefined}
      tabIndex={focused ? 0 : -1}
      data-outline-key={node.key}
      data-outline-current={current ? 'true' : undefined}
      draggable={!busy && Boolean(node.target || node.form || node.articleId || node.content)}
      onDragStart={itemDragStart(actions.onDragStart)}
      onDragEnd={actions.onDragEnd}
      onClick={(event) => {
        if (!busy) actions.onChoose(event);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (!busy) actions.onOpen();
      }}
      onKeyDown={(event) => {
        if (!busy && event.target === event.currentTarget) actions.onKeyDown(event);
      }}
      onDragOver={actions.onDragOver}
      onDrop={actions.onDrop}
      className={cn(
        'group/item flex h-10 min-w-0 items-center gap-1 pr-2 text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-selected text-selected-foreground hover:bg-selected',
        current && 'font-semibold text-selected-foreground ring-1 ring-inset ring-selected-foreground',
        drop && 'ring-2 ring-inset ring-ring',
      )}
      style={{ paddingLeft: 4 + Math.min(depth, 12) * 18 }}
      title={node.label + ' · ' + path}
    >
      {node.children.length ? (
        <Button
          data-item-drag-ignore
          variant="ghost"
          size="icon-sm"
          className="h-9 w-14 shrink-0 gap-1.5"
          disabled={busy || !collapsible}
          aria-label={expanded ? labels.collapse : labels.expand}
          title={labels.branchDisclosureHelp}
          onClick={(event) => {
            event.stopPropagation();
            actions.onToggle(event.shiftKey);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <ChevronRightIcon className={cn('size-3.5', expanded && 'rotate-90')} />
          {preview}
        </Button>
      ) : (
        <span className="flex h-9 w-14 shrink-0 items-center justify-end pr-1">{preview}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{node.title}</span>
      <ItemActions onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={node.contentAction ? node.title : node.content ? labels.editContent : labels.open}
          title={node.label}
          onClick={actions.onOpen}
        >
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
        <OutlineNodeMenu
          node={node}
          busy={busy}
          actions={nodeActions}
          organization={organization}
          onOpen={actions.onOpen}
          onFocus={actions.onFocus}
          onMove={actions.onMove}
          onOpenSource={actions.onOpenSource}
        />
      </ItemActions>
    </div>
  );
}
