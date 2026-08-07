import { useEffect, useState } from 'react';
import type { FacetDefinitionDto, Locale, TermListItem, WordPaletteDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { WordPaletteEditor } from '@/renderer/components/palette/WordPaletteEditor';

interface Props {
  locale: Locale;
  open: boolean;
  palette?: WordPaletteDto | null;
  termIds?: string[];
  terms: TermListItem[];
  facets: FacetDefinitionDto[];
  onOpenChange(open: boolean): void;
  onSaved?(palette: WordPaletteDto, action: 'created' | 'updated'): void | Promise<void>;
  onCreated?(palette: WordPaletteDto): void;
  onLifecycleChanged?(action: 'archived' | 'restored' | 'deleted'): void | Promise<void>;
}

export function SaveWordPaletteDialog({
  locale,
  open,
  palette = null,
  termIds = [],
  terms,
  facets,
  onOpenChange,
  onSaved,
  onCreated,
  onLifecycleChanged,
}: Props) {
  const messages = useI18n().messages.recipe.editor;
  const title = palette ? messages.title : messages.createTitle;
  const [fullWindow, setFullWindow] = useState(false);
  useEffect(() => {
    if (!open) setFullWindow(false);
  }, [open]);
  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) setFullWindow(false);
    onOpenChange(nextOpen);
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'h-[min(760px,calc(100vh-2rem))] max-w-[min(1180px,calc(100vw-2rem))] gap-0 p-0',
          fullWindow && 'inset-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0',
        )}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {open && (
          <WordPaletteEditor
            locale={locale}
            palette={palette}
            initialTermIds={termIds}
            terms={terms}
            facets={facets}
            onBack={() => changeOpen(false)}
            onFullWindowChange={setFullWindow}
            onSaved={async (savedPalette, action) => {
              await onSaved?.(savedPalette, action);
              if (action === 'created') onCreated?.(savedPalette);
              changeOpen(false);
            }}
            onLifecycleChanged={async (action) => {
              await onLifecycleChanged?.(action);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
