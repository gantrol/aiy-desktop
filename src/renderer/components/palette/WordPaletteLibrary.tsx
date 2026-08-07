import { useEffect, useMemo, useRef, useState } from 'react';
import { PlusIcon, SearchIcon } from 'lucide-react';
import type { Locale, WordPaletteDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { filterWordPalettes } from '@/renderer/components/palette/utils';
import { WordPaletteLibraryItem } from '@/renderer/components/palette/WordPaletteLibraryItem';

interface Props {
  locale: Locale;
  palettes: WordPaletteDto[];
  action: 'filter' | 'apply';
  draggablePalettes?: boolean;
  focusPaletteId?: string | null;
  onUse?(palette: WordPaletteDto): void;
  onView?(palette: WordPaletteDto): void;
  onCreate?(): void;
  onEdit?(palette: WordPaletteDto): void;
  onDelete?(palette: WordPaletteDto): void;
  notify(message: string): void;
}

export function WordPaletteLibrary({
  locale,
  palettes,
  action,
  draggablePalettes = false,
  focusPaletteId = null,
  onUse,
  onView,
  onCreate,
  onEdit,
  onDelete,
  notify,
}: Props) {
  const { messages } = useI18n();
  const l = messages.recipe.library;
  const newRecipe = messages.dictionary.wordPalette.newRecipe;
  const rootRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const visiblePalettes = useMemo(() => filterWordPalettes(palettes, query), [palettes, query]);

  useEffect(() => {
    if (focusPaletteId) setQuery('');
  }, [focusPaletteId]);

  useEffect(() => {
    if (!focusPaletteId || !visiblePalettes.some((palette) => palette.id === focusPaletteId)) return;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-focus-palette-id]') ?? []).find(
        (element) => element.dataset.focusPaletteId === focusPaletteId,
      );
      target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPaletteId, visiblePalettes]);

  return (
    <section ref={rootRef} className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex gap-2 border-b p-3">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            data-action="word-palette-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={l.search}
            placeholder={l.search}
            className="pl-9"
          />
        </div>
        {onCreate && (
          <Button data-action="word-palette-create" type="button" onClick={onCreate}>
            <PlusIcon className="size-4" />
            {newRecipe}
          </Button>
        )}
      </div>
      <ScrollArea type="always" className="min-h-0">
        <div
          className={cn(
            'grid gap-3 p-3 pr-5',
            action === 'apply' ? 'grid-cols-2' : 'grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3',
          )}
        >
          {visiblePalettes.map((palette) => (
            <div
              key={palette.id}
              data-focus-palette-id={palette.id}
              className={cn('rounded-lg', focusPaletteId === palette.id && 'ring-2 ring-ring ring-offset-2')}
            >
              <WordPaletteLibraryItem
                locale={locale}
                palette={palette}
                action={action}
                draggable={draggablePalettes}
                onUse={onUse}
                onView={onView}
                onEdit={onEdit}
                onDelete={onDelete}
                notify={notify}
              />
            </div>
          ))}
          {!visiblePalettes.length && (
            <div className="col-span-full grid min-h-48 place-items-center text-sm text-muted-foreground">
              {palettes.length ? l.noMatch : l.empty}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
