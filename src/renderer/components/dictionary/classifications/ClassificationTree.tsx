import type { DictionaryClassificationNodeDto } from '@/shared/contracts';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BanIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderInputIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
} from 'lucide-react';
import type { DragEvent } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import type { ClassificationTreeIndex } from '@/renderer/components/dictionary/classifications/classification-tree';
import { classificationParentKey } from '@/renderer/components/dictionary/classifications/classification-tree';

interface Props {
  rootId: string;
  tree: ClassificationTreeIndex;
  selectedId: string;
  expandedIds: Set<string>;
  visibleIds: Set<string>;
  searchActive: boolean;
  busy: boolean;
  draggingId: string | null;
  dropTargetId: string | null;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onCreateChild(node: DictionaryClassificationNodeDto): void;
  onRename(node: DictionaryClassificationNodeDto): void;
  onMove(node: DictionaryClassificationNodeDto): void;
  onReorder(node: DictionaryClassificationNodeDto, direction: -1 | 1): void;
  onSetState(node: DictionaryClassificationNodeDto): void;
  onDragStart(id: string): void;
  onDragEnd(): void;
  onDropTargetChange(id: string | null): void;
  onDrop(sourceId: string, targetParentId: string): void;
}

function ClassificationBranch({ node, props }: { node: DictionaryClassificationNodeDto; props: Props }) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.tree;
  const children = (props.tree.childrenByParent.get(classificationParentKey(node.id)) ?? []).filter((child) =>
    props.visibleIds.has(child.id),
  );
  const siblings = props.tree.childrenByParent.get(classificationParentKey(node.parentId)) ?? [];
  const siblingIndex = siblings.findIndex((sibling) => sibling.id === node.id);
  const expanded = props.searchActive || props.expandedIds.has(node.id);
  const actions: ActionMenuAction[] = [
    {
      id: 'create-child',
      label: copy.newChild,
      icon: PlusIcon,
      disabled: props.busy || node.state === 'DISABLED',
      onSelect: () => props.onCreateChild(node),
    },
    {
      id: 'rename',
      label: copy.rename,
      icon: PencilIcon,
      disabled: props.busy,
      onSelect: () => props.onRename(node),
    },
    {
      id: 'move',
      label: copy.move,
      icon: FolderInputIcon,
      disabled: props.busy,
      onSelect: () => props.onMove(node),
    },
    {
      id: 'move-up',
      label: copy.moveUp,
      icon: ArrowUpIcon,
      disabled: props.busy || siblingIndex <= 0,
      onSelect: () => props.onReorder(node, -1),
    },
    {
      id: 'move-down',
      label: copy.moveDown,
      icon: ArrowDownIcon,
      disabled: props.busy || siblingIndex < 0 || siblingIndex >= siblings.length - 1,
      onSelect: () => props.onReorder(node, 1),
    },
    {
      id: 'set-state',
      label: node.state === 'ACTIVE' ? copy.disable : copy.restore,
      icon: node.state === 'ACTIVE' ? BanIcon : RotateCcwIcon,
      destructive: node.state === 'ACTIVE',
      separatorBefore: true,
      disabled: props.busy,
      onSelect: () => props.onSetState(node),
    },
  ];

  function acceptDrop(event: DragEvent<HTMLDivElement>) {
    if (!props.draggingId || props.draggingId === node.id) return;
    event.preventDefault();
    event.stopPropagation();
    props.onDrop(props.draggingId, node.id);
    props.onDropTargetChange(null);
  }

  return (
    <div className="relative" data-classification-branch={node.id}>
      <div
        data-classification-id={node.id}
        data-selected={props.selectedId === node.id ? 'true' : 'false'}
        className={cn(
          'group relative flex h-10 items-center gap-1 rounded-md pr-1 text-sm transition-colors duration-fast',
          props.selectedId === node.id
            ? 'bg-selected font-medium text-selected-foreground'
            : 'text-foreground hover:bg-hover',
          node.state === 'DISABLED' && 'text-disabled-foreground',
          props.dropTargetId === node.id && 'ring-1 ring-inset ring-selected-border',
          props.draggingId === node.id && 'opacity-45',
        )}
        onDragEnter={(event) => {
          if (!props.draggingId || props.draggingId === node.id) return;
          event.preventDefault();
          props.onDropTargetChange(node.id);
        }}
        onDragOver={(event) => {
          if (!props.draggingId || props.draggingId === node.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onDropTargetChange(null);
        }}
        onDrop={acceptDrop}
      >
        <span
          draggable={!props.busy}
          title={copy.drag}
          className="grid size-7 shrink-0 cursor-grab place-items-center rounded text-muted-foreground active:cursor-grabbing"
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', node.id);
            props.onDragStart(node.id);
          }}
          onDragEnd={props.onDragEnd}
        >
          <GripVerticalIcon className="size-3.5" />
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn('size-7', !children.length && 'invisible')}
          aria-label={expanded ? copy.collapse : copy.expand}
          onClick={() => props.onToggle(node.id)}
        >
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        </Button>
        <button
          data-action="classification-select"
          type="button"
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none"
          onClick={() => props.onSelect(node.id)}
        >
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{node.subtreeTermCount}</span>
        </button>
        <ActionMenuButton
          actions={actions}
          label={copy.moreActionsFor(node.name)}
          className="size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
      {children.length > 0 && expanded && (
        <div className="relative ml-[2.15rem] border-l border-border pl-3">
          {children.map((child) => (
            <ClassificationBranch key={child.id} node={child} props={props} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ClassificationTree(props: Props) {
  const children = (props.tree.childrenByParent.get(classificationParentKey(props.rootId)) ?? []).filter((node) =>
    props.visibleIds.has(node.id),
  );
  return (
    <div className="space-y-0.5 p-2">
      {children.map((node) => (
        <ClassificationBranch key={node.id} node={node} props={props} />
      ))}
    </div>
  );
}
