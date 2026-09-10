import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, Link2Icon } from 'lucide-react';
import type { CreationFormRole } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { creationFormIcons } from '@/renderer/components/creator/creationFormIcons';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/renderer/components/ui/sheet';
import { cn } from '@/renderer/lib/utils';

export interface CreationRelationItem {
  formId: string;
  role: CreationFormRole;
  direction: 'SOURCE' | 'DERIVED';
  title: string;
  imageAssetIds: readonly string[];
  assetId?: string;
}

function CreationRelationButton({
  item,
  onSelect,
}: {
  item: CreationRelationItem;
  onSelect(item: CreationRelationItem): void;
}) {
  const { messages } = useI18n();
  const labels = messages.creator.workNavigation;
  const Icon = creationFormIcons[item.role];

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-h-12 w-full justify-start gap-3 px-3 py-2 text-left"
      onClick={() => onSelect(item)}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block text-xs font-normal text-muted-foreground">
          {item.direction === 'SOURCE' ? labels.source : labels.derived} · {messages.creator.album.formKinds[item.role]}
        </span>
      </span>
    </Button>
  );
}

const relationPreviewPageSize = 3;

export function CreationRelationsPreview({
  items,
  onSelect,
}: {
  items: readonly CreationRelationItem[];
  onSelect(item: CreationRelationItem): void;
}) {
  const labels = useI18n().messages.creator.workNavigation;
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / relationPreviewPageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleItems = items.slice(visiblePage * relationPreviewPageSize, (visiblePage + 1) * relationPreviewPageSize);
  const sourceCount = items.filter((item) => item.direction === 'SOURCE').length;
  const derivedCount = items.length - sourceCount;

  return (
    <Collapsible open={Boolean(items.length) && open} onOpenChange={setOpen} className="border-t pt-3">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-h-8 w-full min-w-0 justify-start px-2 text-left"
          disabled={!items.length}
        >
          <ChevronRightIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && items.length && 'rotate-90',
            )}
          />
          <Link2Icon className="size-4" />
          <span className="truncate">
            {labels.relatedContent} · {items.length}
          </span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {labels.source} {sourceCount} · {labels.derived} {derivedCount}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-1 pt-1">
          {visibleItems.map((item) => (
            <CreationRelationButton key={item.formId} item={item} onSelect={onSelect} />
          ))}
        </div>
        {pageCount > 1 && (
          <nav className="flex items-center justify-end gap-1 pt-1" aria-label={labels.relationPages}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={visiblePage === 0}
              aria-label={labels.previousPage}
              onClick={() => setPage(visiblePage - 1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {visiblePage + 1} / {pageCount}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={visiblePage >= pageCount - 1}
              aria-label={labels.nextPage}
              onClick={() => setPage(visiblePage + 1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </nav>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CreationRelationsSheet({
  items,
  open,
  filteredAssetId,
  onOpenChange,
  onSelect,
}: {
  items: readonly CreationRelationItem[];
  open: boolean;
  filteredAssetId: string | null;
  onOpenChange(open: boolean): void;
  onSelect(item: CreationRelationItem): void;
}) {
  const labels = useI18n().messages.creator.workNavigation;
  const visibleItems = filteredAssetId ? items.filter((item) => item.imageAssetIds.includes(filteredAssetId)) : items;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0">
        <SheetHeader className="h-14 shrink-0 justify-center border-b px-5 pr-12">
          <SheetTitle>
            {filteredAssetId ? labels.imageRelations : labels.relatedContent} · {visibleItems.length}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-1 p-3">
            {visibleItems.map((item) => (
              <CreationRelationButton
                key={item.formId}
                item={item}
                onSelect={(selectedItem) => {
                  onOpenChange(false);
                  onSelect(filteredAssetId ? { ...selectedItem, assetId: filteredAssetId } : selectedItem);
                }}
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
