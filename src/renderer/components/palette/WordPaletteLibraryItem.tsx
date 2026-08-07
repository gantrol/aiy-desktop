import { forwardRef, type ComponentPropsWithoutRef, type DragEvent } from 'react';
import { ArchiveIcon, EyeIcon, PencilIcon, SlidersHorizontalIcon, Trash2Icon } from 'lucide-react';
import type { Locale, WordPaletteDto } from '@/shared/contracts';
import type { RecipeItemMessages } from '@/renderer/i18n/catalog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import {
  clearWordPaletteRecipeDrag,
  writeWordPaletteRecipeDrag,
} from '@/renderer/components/palette/wordPaletteInteractions';

interface Props {
  locale: Locale;
  palette: WordPaletteDto;
  action: 'filter' | 'apply';
  draggable?: boolean;
  onUse?(palette: WordPaletteDto): void;
  onView?(palette: WordPaletteDto): void;
  onEdit?(palette: WordPaletteDto): void;
  onDelete?(palette: WordPaletteDto): void;
  notify(message: string): void;
}

export function WordPaletteBadges({ palette, labels }: { palette: WordPaletteDto; labels: RecipeItemMessages }) {
  return (
    <>
      <Badge variant="outline">V{palette.revisionNo}</Badge>
      {palette.parameters.length > 0 && (
        <Badge variant="secondary">
          <SlidersHorizontalIcon className="size-3" />
          {labels.parameterized}
        </Badge>
      )}
      {palette.status === 'ARCHIVED' && (
        <StateTag tone="locked" className="text-lifecycle-archived" icon={<ArchiveIcon />}>
          {labels.archived}
        </StateTag>
      )}
    </>
  );
}

export function WordPaletteDetails({
  palette,
  labels,
  notify,
}: {
  palette: WordPaletteDto;
  labels: RecipeItemMessages;
  notify(message: string): void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {palette.referenceAssets.length > 0 && (
        <div className="flex items-center gap-2">
          <MediaStackPreview size="sm" items={palette.referenceAssets.map((asset) => ({ asset }))} notify={notify} />
          <span className="text-xs text-muted-foreground">{palette.referenceAssets.length}</span>
        </div>
      )}
      {palette.terms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {palette.terms.slice(0, 18).map((term) => (
            <span key={term.id} className="rounded-full bg-muted px-2 py-1 text-xs">
              {term.title}
            </span>
          ))}
          {palette.terms.length > 18 && (
            <span className="px-1 py-1 text-xs text-muted-foreground">+{palette.terms.length - 18}</span>
          )}
        </div>
      )}
      {palette.parameters.map((parameter) => (
        <div key={parameter.id} className="flex items-start gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">{parameter.name}</span>
          <span>{parameter.options.map((option) => option.label).join(' / ')}</span>
        </div>
      ))}
      <footer className="mt-auto flex gap-3 pt-1 text-[11px] text-muted-foreground">
        <span>
          {palette.terms.length} {labels.terms}
        </span>
        <span>
          {labels.used} {palette.usageCount}
        </span>
      </footer>
    </div>
  );
}

function PaletteActions({
  palette,
  action,
  labels,
  onUse,
  onView,
  onEdit,
}: Omit<Props, 'locale' | 'onDelete' | 'notify'> & { labels: RecipeItemMessages }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {onView && (
        <Button
          data-action="word-palette-view"
          type="button"
          variant="ghost"
          size="sm"
          aria-label={labels.view}
          title={labels.view}
          onClick={() => onView(palette)}
        >
          <EyeIcon className="size-3.5" />
          {labels.view}
        </Button>
      )}
      {onEdit && (
        <Button
          data-action="word-palette-edit"
          type="button"
          variant="ghost"
          size="icon-sm"
          className="bg-transparent hover:bg-transparent active:bg-transparent"
          aria-label={labels.edit}
          title={labels.edit}
          onClick={() => onEdit(palette)}
        >
          <PencilIcon className="size-3.5 text-[var(--button-primary)]" />
        </Button>
      )}
      {action === 'apply' && onUse && (
        <Button
          data-action="word-palette-use"
          type="button"
          size="sm"
          disabled={palette.status === 'ARCHIVED'}
          onClick={() => onUse(palette)}
        >
          {labels.apply}
        </Button>
      )}
    </div>
  );
}

const ExpandedPalette = forwardRef<
  HTMLElement,
  Omit<Props, 'locale' | 'onDelete'> & { labels: RecipeItemMessages } & ComponentPropsWithoutRef<'article'>
>(function ExpandedPalette({ palette, action, labels, onUse, onView, onEdit, notify, ...articleProps }, ref) {
  return (
    <article
      ref={ref}
      {...articleProps}
      data-palette-id={palette.id}
      className="flex h-full flex-col gap-3 rounded-lg border bg-background p-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <strong className="truncate text-sm">{palette.name}</strong>
            <WordPaletteBadges palette={palette} labels={labels} />
          </div>
          {palette.description && <p className="mt-1 truncate text-xs text-muted-foreground">{palette.description}</p>}
        </div>
        <PaletteActions
          palette={palette}
          action={action}
          labels={labels}
          onUse={onUse}
          onView={onView}
          onEdit={onEdit}
        />
      </header>
      <WordPaletteDetails palette={palette} labels={labels} notify={notify} />
    </article>
  );
});

const CollapsedPalette = forwardRef<
  HTMLElement,
  Omit<Props, 'locale' | 'onDelete' | 'onEdit' | 'notify'> & {
    labels: RecipeItemMessages;
  } & ComponentPropsWithoutRef<'article'>
>(function CollapsedPalette({ palette, action, labels, onUse, onView, ...articleProps }, ref) {
  return (
    <article
      ref={ref}
      {...articleProps}
      data-palette-id={palette.id}
      className="flex min-h-14 items-center gap-3 rounded-lg border bg-background px-3 py-2 transition-colors hover:bg-muted/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <strong className="truncate text-sm">{palette.name}</strong>
          <WordPaletteBadges palette={palette} labels={labels} />
        </div>
        {palette.description && <p className="mt-1 truncate text-xs text-muted-foreground">{palette.description}</p>}
      </div>
      <PaletteActions palette={palette} action={action} labels={labels} onUse={onUse} onView={onView} />
    </article>
  );
});

export function WordPaletteLibraryItem({
  palette,
  action,
  draggable = false,
  onUse,
  onView,
  onEdit,
  onDelete,
  notify,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.recipe.item;
  const compact = action === 'apply';
  const dragProps =
    draggable && palette.status === 'ACTIVE'
      ? {
          draggable: true,
          onDragStart: (event: DragEvent<HTMLElement>) =>
            writeWordPaletteRecipeDrag(event.dataTransfer, {
              paletteId: palette.id,
              origin: 'dictionary',
              plainText: palette.name,
            }),
          onDragEnd: clearWordPaletteRecipeDrag,
        }
      : {};
  if (compact)
    return (
      <HoverCard openDelay={2000} closeDelay={120}>
        <HoverCardTrigger asChild>
          <CollapsedPalette
            {...dragProps}
            palette={palette}
            action={action}
            labels={labels}
            onUse={onUse}
            onView={onView}
          />
        </HoverCardTrigger>
        <HoverCardContent
          data-palette-details={palette.id}
          side="left"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="w-96 max-w-[calc(100vw-2rem)]"
        >
          <div className="grid gap-3">
            <header>
              <div className="flex items-center gap-2">
                <strong className="truncate text-sm">{palette.name}</strong>
                <WordPaletteBadges palette={palette} labels={labels} />
              </div>
              {palette.description && <p className="mt-1 text-xs text-muted-foreground">{palette.description}</p>}
            </header>
            <WordPaletteDetails palette={palette} labels={labels} notify={notify} />
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ExpandedPalette
          {...dragProps}
          palette={palette}
          action={action}
          labels={labels}
          onUse={onUse}
          onView={onView}
          onEdit={onEdit}
          notify={notify}
        />
      </ContextMenuTrigger>
      {onDelete && (
        <ContextMenuContent>
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(palette)}>
            <Trash2Icon />
            {labels.delete}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
