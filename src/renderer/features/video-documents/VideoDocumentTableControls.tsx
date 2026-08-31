import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  ArrowDownToLineIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpToLineIcon,
  ChevronDownIcon,
  Columns3Icon,
  Rows3Icon,
  Table2Icon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';
import { cn } from '@/renderer/lib/utils';

export interface VideoDocumentTableControlsLabels {
  table: string;
  insertTable: string;
  addRowBefore: string;
  addRow: string;
  deleteRow: string;
  addColumnBefore: string;
  addColumn: string;
  deleteColumn: string;
  deleteTable: string;
}

interface TableOperation {
  id: string;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  destructive?: boolean;
  run(): boolean;
}

interface TableCapabilities {
  insertTable: boolean;
  addRowBefore: boolean;
  addRowAfter: boolean;
  deleteRow: boolean;
  addColumnBefore: boolean;
  addColumnAfter: boolean;
  deleteColumn: boolean;
  deleteTable: boolean;
}

function useTableCapabilities(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: current }): TableCapabilities => {
      const can = current.can();
      return {
        insertTable: can.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
        addRowBefore: can.addRowBefore(),
        addRowAfter: can.addRowAfter(),
        deleteRow: can.deleteRow(),
        addColumnBefore: can.addColumnBefore(),
        addColumnAfter: can.addColumnAfter(),
        deleteColumn: can.deleteColumn(),
        deleteTable: can.deleteTable(),
      };
    },
  });
}

function tableOperations(editor: Editor, labels: VideoDocumentTableControlsLabels, can: TableCapabilities) {
  const rows: TableOperation[] = [
    {
      id: 'add-row-before',
      label: labels.addRowBefore,
      icon: ArrowUpToLineIcon,
      enabled: can.addRowBefore,
      run: () => editor.chain().focus().addRowBefore().run(),
    },
    {
      id: 'add-row-after',
      label: labels.addRow,
      icon: ArrowDownToLineIcon,
      enabled: can.addRowAfter,
      run: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      id: 'delete-row',
      label: labels.deleteRow,
      icon: Rows3Icon,
      enabled: can.deleteRow,
      destructive: true,
      run: () => editor.chain().focus().deleteRow().run(),
    },
  ];
  const columns: TableOperation[] = [
    {
      id: 'add-column-before',
      label: labels.addColumnBefore,
      icon: ArrowLeftToLineIcon,
      enabled: can.addColumnBefore,
      run: () => editor.chain().focus().addColumnBefore().run(),
    },
    {
      id: 'add-column-after',
      label: labels.addColumn,
      icon: ArrowRightToLineIcon,
      enabled: can.addColumnAfter,
      run: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      id: 'delete-column',
      label: labels.deleteColumn,
      icon: Columns3Icon,
      enabled: can.deleteColumn,
      destructive: true,
      run: () => editor.chain().focus().deleteColumn().run(),
    },
  ];
  const remove: TableOperation = {
    id: 'delete-table',
    label: labels.deleteTable,
    icon: Trash2Icon,
    enabled: can.deleteTable,
    destructive: true,
    run: () => editor.chain().focus().deleteTable().run(),
  };
  return { rows, columns, remove };
}

function MenuOperationButton({ operation, onRun }: { operation: TableOperation; onRun(): void }) {
  const Icon = operation.icon;
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-8 w-full justify-start rounded-sm px-2 text-xs font-normal',
        operation.destructive && 'text-destructive hover:bg-destructive-surface hover:text-destructive',
      )}
      disabled={!operation.enabled}
      onClick={onRun}
    >
      <Icon className="size-3.5" />
      {operation.label}
    </Button>
  );
}

function InlineOperationButton({ operation }: { operation: TableOperation }) {
  const Icon = operation.icon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="2xs"
      className={cn(
        'gap-1.5 px-2 font-normal',
        operation.destructive && 'text-destructive hover:bg-destructive-surface hover:text-destructive',
      )}
      disabled={!operation.enabled}
      onClick={() => operation.run()}
    >
      <Icon className="size-3.5" />
      {operation.label}
    </Button>
  );
}

export function VideoDocumentTableMenu({
  editor,
  active,
  labels,
}: {
  editor: Editor;
  active: boolean;
  labels: VideoDocumentTableControlsLabels;
}) {
  const [open, setOpen] = useState(false);
  const can = useTableCapabilities(editor);
  const operations = tableOperations(editor, labels, can);
  const insertOperation: TableOperation = {
    id: 'insert-table',
    label: labels.insertTable,
    icon: Table2Icon,
    enabled: can.insertTable,
    run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  };

  function run(operation: TableOperation) {
    if (operation.run()) setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn(
            'h-7 gap-1 px-2 font-normal',
            active && 'bg-selected text-selected-foreground hover:bg-selected/80',
          )}
          aria-label={labels.table}
        >
          <Table2Icon className="size-3.5" />
          {labels.table}
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1" onCloseAutoFocus={(event) => event.preventDefault()}>
        {!active ? (
          <MenuOperationButton operation={insertOperation} onRun={() => run(insertOperation)} />
        ) : (
          <>
            {operations.rows.map((operation) => (
              <MenuOperationButton key={operation.id} operation={operation} onRun={() => run(operation)} />
            ))}
            <Separator className="my-1" />
            {operations.columns.map((operation) => (
              <MenuOperationButton key={operation.id} operation={operation} onRun={() => run(operation)} />
            ))}
            <Separator className="my-1" />
            <MenuOperationButton operation={operations.remove} onRun={() => run(operations.remove)} />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function VideoDocumentTableOperations({
  editor,
  labels,
}: {
  editor: Editor;
  labels: VideoDocumentTableControlsLabels;
}) {
  const can = useTableCapabilities(editor);
  const operations = tableOperations(editor, labels, can);
  return (
    <div
      data-slot="video-document-table-operations"
      role="toolbar"
      aria-label={labels.table}
      className="sticky top-9 z-30 flex min-h-8 items-center gap-0.5 overflow-x-auto border-b bg-background/96 px-1.5 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="flex shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium text-foreground-secondary">
        <Table2Icon className="size-3.5" />
        {labels.table}
      </span>
      <Separator orientation="vertical" className="mx-1 h-4" />
      {operations.rows.map((operation) => (
        <InlineOperationButton key={operation.id} operation={operation} />
      ))}
      <Separator orientation="vertical" className="mx-1 h-4" />
      {operations.columns.map((operation) => (
        <InlineOperationButton key={operation.id} operation={operation} />
      ))}
      <Separator orientation="vertical" className="mx-1 h-4" />
      <InlineOperationButton operation={operations.remove} />
    </div>
  );
}
