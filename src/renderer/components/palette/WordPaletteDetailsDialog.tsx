import { PencilIcon } from 'lucide-react';
import type { WordPaletteDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { WordPaletteBadges, WordPaletteDetails } from '@/renderer/components/palette/WordPaletteLibraryItem';

interface Props {
  open: boolean;
  palette: WordPaletteDto | null;
  onOpenChange(open: boolean): void;
  onEdit(palette: WordPaletteDto): void;
  notify(message: string): void;
}

export function WordPaletteDetailsDialog({ open, palette, onOpenChange, onEdit, notify }: Props) {
  const { messages } = useI18n();
  const labels = messages.recipe.item;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-2 pr-7">
            <DialogTitle className="truncate">{palette?.name}</DialogTitle>
            {palette && <WordPaletteBadges palette={palette} labels={labels} />}
          </div>
          <DialogDescription className={palette?.description ? undefined : 'sr-only'}>
            {palette?.description || palette?.name}
          </DialogDescription>
        </DialogHeader>
        {palette && (
          <ScrollArea className="max-h-[min(560px,calc(100vh-12rem))]">
            <div className="p-5">
              <WordPaletteDetails palette={palette} labels={labels} notify={notify} />
            </div>
          </ScrollArea>
        )}
        <DialogFooter className="border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {messages.common.close}
          </Button>
          {palette && (
            <Button data-action="word-palette-view-edit" type="button" onClick={() => onEdit(palette)}>
              <PencilIcon className="size-4" />
              {labels.edit}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
