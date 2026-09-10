import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  LayersIcon,
  Maximize2Icon,
  ArrowUpRightIcon,
} from 'lucide-react';
import type { DragEvent, MouseEvent, KeyboardEvent, Ref } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { OutlineRow } from '@/renderer/features/creation-outline/outline-tree';
import { OutlineNodePreview } from '@/renderer/features/creation-outline/OutlineNodePreview';

interface Props {
  row: OutlineRow;
  active: boolean;
  path: string;
  expanded: boolean;
  collapsible: boolean;
  selected: boolean;
  focused: boolean;
  drop: boolean;
  busy: boolean;
  elementRef: Ref<HTMLDivElement>;
  onChoose(event: MouseEvent<HTMLDivElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onToggle(wholeBranch: boolean): void;
  onFocus(): void;
  onOpen(): void;
  onDragStart(event: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
}
export function OutlineTreeRow({
  row,
  active,
  path,
  expanded,
  collapsible,
  selected,
  focused,
  drop,
  busy,
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
      aria-expanded={node.children.length ? expanded : undefined}
      tabIndex={focused ? 0 : -1}
      data-outline-key={node.key}
      onClick={(event) => {
        if (!busy) actions.onChoose(event);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (!busy) actions.onOpen();
      }}
      onKeyDown={(event) => {
        if (!busy) actions.onKeyDown(event);
      }}
      onDragOver={actions.onDragOver}
      onDrop={actions.onDrop}
      className={cn(
        'group flex h-10 min-w-0 items-center gap-1 pr-2 text-sm outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-selected text-selected-foreground',
        drop && 'ring-2 ring-inset ring-ring',
      )}
      style={{ paddingLeft: 4 + Math.min(depth, 12) * 18 }}
      title={node.label + ' · ' + path}
    >
      {node.children.length ? (
        <Button
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
      <div
        className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {node.children.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={labels.focus}
            title={labels.focus}
            onClick={actions.onFocus}
          >
            <Maximize2Icon className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={labels.open}
          title={node.label}
          onClick={actions.onOpen}
        >
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
        {node.target &&
          (busy ? (
            <span className="size-6" />
          ) : (
            <TreeDragHandle
              label={labels.move}
              className="bg-transparent shadow-none"
              onDragStart={actions.onDragStart}
              onDragEnd={actions.onDragEnd}
            />
          ))}
      </div>
    </div>
  );
}
