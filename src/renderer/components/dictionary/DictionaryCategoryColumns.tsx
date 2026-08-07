import { useEffect, useRef } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import type { DictionaryCategoryBrowserColumn } from '@/renderer/components/dictionary/dictionary-category-browser';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';

interface Props {
  columns: DictionaryCategoryBrowserColumn[];
  onSelect(level: number, categoryId: string): void;
  onPreview(level: number, categoryId: string): void;
  onCancelPreview(): void;
}

export function DictionaryCategoryColumns({ columns, onSelect, onPreview, onCancelPreview }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastColumnParentId = columns.at(-1)?.parentId;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => container.scrollTo({ left: container.scrollWidth }));
    return () => cancelAnimationFrame(frame);
  }, [columns.length, lastColumnParentId]);

  return (
    <div
      ref={containerRef}
      data-dictionary-category-columns
      className="flex min-h-0 min-w-56 shrink-0 overflow-x-auto border-r bg-background"
      style={{
        width: `min(${Math.max(columns.length, 1) * 14}rem, 60%)`,
        maxWidth: 'calc(100% - 20rem)',
      }}
    >
      {columns.map((column, level) => (
        <ScrollArea
          key={column.parentId ?? 'root'}
          data-classification-level={level + 1}
          type="always"
          className="min-h-0 w-56 shrink-0 border-r bg-muted/20 last:border-r-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
        >
          <div className="space-y-1 p-2 pr-3">
            {column.options.map((option) => (
              <Button
                key={option.id}
                data-classification-option={option.id}
                data-palette-domain={level === 0 ? option.stableKey : undefined}
                data-palette-type={level === 1 ? option.stableKey : undefined}
                type="button"
                variant={option.id === column.selectedId ? 'secondary' : 'ghost'}
                className="h-9 w-full justify-between px-2 font-normal"
                onMouseEnter={() => onPreview(level, option.id)}
                onMouseLeave={onCancelPreview}
                onFocus={() => onSelect(level, option.id)}
                onClick={() => onSelect(level, option.id)}
              >
                <span className="truncate">{option.name}</span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  {option.count}
                  <ChevronRightIcon className="size-3" />
                </span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      ))}
    </div>
  );
}
