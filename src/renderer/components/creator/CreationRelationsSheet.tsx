import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, FileTextIcon, ImageIcon, Link2Icon, PanelsTopLeftIcon } from 'lucide-react';
import type { CreationFormRole, Locale } from '@/shared/contracts';
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
}

function relationLabel(role: CreationFormRole, zh: boolean) {
  if (role === 'ARTICLE') return zh ? '文章' : 'Article';
  if (role === 'SOCIAL_POST') return zh ? '贴图' : 'Social post';
  if (role === 'ARTICLE_HEADER') return zh ? '题图' : 'Hero image';
  if (role === 'ARTICLE_INLINE') return zh ? '配图' : 'Illustration';
  if (role === 'SOCIAL_POST_COVER') return zh ? '封面' : 'Cover';
  return zh ? '创作' : 'Creation';
}

function RelationIcon({ role }: { role: CreationFormRole }) {
  if (role === 'ARTICLE') return <FileTextIcon className="size-4" />;
  if (role === 'SOCIAL_POST') return <PanelsTopLeftIcon className="size-4" />;
  return <ImageIcon className="size-4" />;
}

function CreationRelationButton({
  item,
  locale,
  onSelect,
}: {
  item: CreationRelationItem;
  locale: Locale;
  onSelect(item: CreationRelationItem): void;
}) {
  const zh = locale === 'zh';

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-h-12 w-full justify-start gap-3 px-3 py-2 text-left"
      onClick={() => onSelect(item)}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
        <RelationIcon role={item.role} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block text-xs font-normal text-muted-foreground">
          {item.direction === 'SOURCE' ? (zh ? '来源' : 'Source') : zh ? '衍生' : 'Derived'} ·{' '}
          {relationLabel(item.role, zh)}
        </span>
      </span>
    </Button>
  );
}

const relationPreviewPageSize = 3;

export function CreationRelationsPreview({
  items,
  locale,
  onSelect,
}: {
  items: readonly CreationRelationItem[];
  locale: Locale;
  onSelect(item: CreationRelationItem): void;
}) {
  const zh = locale === 'zh';
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / relationPreviewPageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleItems = items.slice(visiblePage * relationPreviewPageSize, (visiblePage + 1) * relationPreviewPageSize);
  const coverCount = items.filter((item) => item.direction === 'DERIVED' && item.role === 'SOCIAL_POST_COVER').length;
  const articleCount = items.filter((item) => item.direction === 'DERIVED' && item.role === 'ARTICLE').length;

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
          <span className="truncate">{zh ? `关联内容 ${items.length}` : `Related ${items.length}`}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {zh ? `封面 ${coverCount} · 文章 ${articleCount}` : `Covers ${coverCount} · Articles ${articleCount}`}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-1 pt-1">
          {visibleItems.map((item) => (
            <CreationRelationButton key={item.formId} item={item} locale={locale} onSelect={onSelect} />
          ))}
        </div>
        {pageCount > 1 && (
          <nav
            className="flex items-center justify-end gap-1 pt-1"
            aria-label={zh ? '关联内容分页' : 'Related content pages'}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={visiblePage === 0}
              aria-label={zh ? '上一页' : 'Previous page'}
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
              aria-label={zh ? '下一页' : 'Next page'}
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
  locale,
  open,
  filteredAssetId,
  onOpenChange,
  onSelect,
}: {
  items: readonly CreationRelationItem[];
  locale: Locale;
  open: boolean;
  filteredAssetId: string | null;
  onOpenChange(open: boolean): void;
  onSelect(item: CreationRelationItem): void;
}) {
  const zh = locale === 'zh';
  const visibleItems = filteredAssetId ? items.filter((item) => item.imageAssetIds.includes(filteredAssetId)) : items;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0">
        <SheetHeader className="h-14 shrink-0 justify-center border-b px-5 pr-12">
          <SheetTitle>
            {filteredAssetId
              ? zh
                ? `图片关联 · ${visibleItems.length}`
                : `Image relations · ${visibleItems.length}`
              : zh
                ? `关联内容 · ${visibleItems.length}`
                : `Related content · ${visibleItems.length}`}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-1 p-3">
            {visibleItems.map((item) => (
              <CreationRelationButton
                key={item.formId}
                item={item}
                locale={locale}
                onSelect={(selectedItem) => {
                  onOpenChange(false);
                  onSelect(selectedItem);
                }}
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
