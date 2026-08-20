import { GripVerticalIcon } from 'lucide-react';
import type { DragEventHandler } from 'react';
import { cn } from '@/renderer/lib/utils';

interface Props {
  label: string;
  className?: string;
  onDragStart: DragEventHandler<HTMLSpanElement>;
  onDragEnd(): void;
}

/** Keeps tree movement intentional instead of making the whole navigation row draggable. */
export function TreeDragHandle({ label, className, onDragStart, onDragEnd }: Props) {
  return (
    <span
      draggable
      aria-hidden="true"
      title={label}
      data-tree-drag-handle
      className={cn(
        'pointer-events-auto relative z-10 grid size-6 shrink-0 cursor-grab place-items-center rounded-md bg-overlay/95 text-muted-foreground shadow-overlay hover:bg-hover-strong active:cursor-grabbing',
        className,
      )}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <GripVerticalIcon className="size-3.5" />
    </span>
  );
}
