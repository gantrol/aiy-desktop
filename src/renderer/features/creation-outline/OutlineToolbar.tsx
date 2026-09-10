import type { DragEvent } from 'react';
import { ChevronRightIcon, FolderInputIcon, InfoIcon, SearchIcon, Undo2Icon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { OutlineNode } from '@/renderer/features/creation-outline/outline-tree';

interface Props {
  breadcrumbs: readonly OutlineNode[];
  busy: boolean;
  query: string;
  selectedCount: number;
  movable: boolean;
  canUndo: boolean;
  canExpand: boolean;
  canCollapse: boolean;
  onExpandAll(): void;
  onCollapseAll(): void;
  rootDrop: boolean;
  path(node: OutlineNode): string;
  onFocus(key: string | null): void;
  onQuery(value: string): void;
  onMove(): void;
  onClear(): void;
  onUndo(): void;
  onRootDragOver(event: DragEvent): void;
  onRootDrop(event: DragEvent): void;
}

export function OutlineToolbar({
  breadcrumbs,
  busy,
  query,
  selectedCount,
  movable,
  canUndo,
  canExpand,
  canCollapse,
  onExpandAll,
  onCollapseAll,
  rootDrop,
  path,
  onFocus,
  onQuery,
  onMove,
  onClear,
  onUndo,
  onRootDragOver,
  onRootDrop,
}: Props) {
  const labels = useI18n().messages.creator.outline;
  return (
    <>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFocus(null)}
          disabled={busy}
          onDragOver={onRootDragOver}
          onDrop={onRootDrop}
          className={rootDrop ? 'ring-2 ring-ring' : ''}
        >
          {labels.root}
        </Button>
        {breadcrumbs.map((node) => (
          <span key={node.key} className="flex min-w-0 items-center gap-1">
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
            <Button
              variant="ghost"
              size="sm"
              className="max-w-48 truncate"
              disabled={busy}
              title={path(node)}
              onClick={() => onFocus(node.key)}
            >
              {node.title}
            </Button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {canUndo && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={labels.undo}
              title={labels.undo}
              onClick={onUndo}
            >
              <Undo2Icon className="size-4" />
            </Button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={labels.help} title={labels.help}>
                <InfoIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-2 text-sm">
              <p>{labels.selectionHelp}</p>
              <p>{labels.moveHelp}</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 px-3 py-1">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          disabled={busy}
          className="h-8 min-w-24 flex-1 border-0 bg-transparent shadow-none"
          placeholder={labels.search}
          aria-label={labels.search}
          onChange={(event) => onQuery(event.target.value)}
        />
        {query && (
          <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={labels.clear} onClick={() => onQuery('')}>
            <XIcon className="size-3.5" />
          </Button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" disabled={busy || !canExpand} onClick={onExpandAll}>
            {labels.expandAll}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy || !canCollapse} onClick={onCollapseAll}>
            {labels.collapseAll}
          </Button>
        </div>
      </div>
      {selectedCount > 0 && (
        <div className="flex min-h-10 shrink-0 items-center gap-2 border-y px-3 py-1">
          <span className="text-xs tabular-nums">{labels.selected(selectedCount)}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !movable}
            title={movable ? labels.move : labels.moveHelp}
            onClick={onMove}
          >
            <FolderInputIcon className="size-4" />
            {labels.move}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            disabled={busy}
            aria-label={labels.clear}
            onClick={onClear}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      )}
    </>
  );
}
