import { useEffect, useState } from 'react';
import { CheckIcon, LoaderCircleIcon, SearchIcon } from 'lucide-react';
import type { AssetDto, GalleryItemDto, Locale } from '@/shared/contracts';
import { ImageIcon, UploadIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';

interface Props {
  locale: Locale;
  selectedAssetIds: string[];
  disabled?: boolean;
  onToggle(asset: AssetDto): void;
  onImport(): void | Promise<void>;
}

export function CreationMaterialPicker({ locale, selectedAssetIds, disabled = false, onToggle, onImport }: Props) {
  const labels = useI18n().messages.creator.materialPicker;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GalleryItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void window.desktopApi
        .galleryList({
          locale,
          source: 'ALL',
          query: query.trim() || undefined,
          unratedDimensions: [],
          cursor: null,
          limit: 30,
        })
        .then((page) => {
          if (alive) setItems(page.items);
        })
        .catch((reason) => {
          if (alive) setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [locale, open, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-action="creation-material-picker"
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          disabled={disabled}
          title={labels.add}
          aria-label={labels.add}
        >
          <ImageIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[430px] max-w-[calc(100vw-2rem)] overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b p-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="h-8 border-0 px-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0"
            placeholder={labels.search}
            onChange={(event) => setQuery(event.target.value)}
          />
          {loading && <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex h-9 items-center justify-between border-b px-3 text-[11px] text-muted-foreground">
          <span>{labels.recent}</span>
          {selectedAssetIds.length > 0 && (
            <span>
              {labels.selected} {selectedAssetIds.length}
            </span>
          )}
        </div>
        <ScrollArea className="h-[310px] bg-surface-sunken/20">
          <div className="grid grid-cols-5 gap-2 p-3">
            {items.map((item) => {
              const selected = selectedAssetIds.includes(item.asset.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'relative aspect-[3/4] overflow-hidden rounded-md border border-transparent bg-media-surround-light outline-none transition-colors duration-fast hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    selected && 'border-selected-border bg-selected ring-1 ring-ring',
                  )}
                  aria-pressed={selected}
                  title={item.creation?.seriesTitle ?? item.dictionary?.termName ?? labels.add}
                  onClick={() => onToggle(item.asset)}
                >
                  <img className="size-full object-contain" src={item.asset.mediaUrl} alt="" loading="lazy" />
                  {selected && (
                    <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-sm border border-selected-border bg-selected text-selected-foreground">
                      <CheckIcon className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
            {!loading && !items.length && (
              <div className="col-span-full grid h-44 place-items-center text-xs text-muted-foreground">
                {error || labels.empty}
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              void onImport();
            }}
          >
            <UploadIcon className="size-4" />
            {labels.importing}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
