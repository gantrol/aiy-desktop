import { useEffect, useMemo, useState } from 'react';
import { CheckIcon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import { UploadIcon } from '@/renderer/icons';
import type { DictionaryMessages } from '@/renderer/i18n/catalog';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';

interface Props {
  copy: DictionaryMessages;
  open: boolean;
  busy: boolean;
  assets: AssetDto[];
  existingAssetIds: string[];
  onOpenChange(open: boolean): void;
  onImport(): Promise<void>;
  onAdd(assetIds: string[]): Promise<void>;
}

export function TermMediaPickerDialog({
  copy: c,
  open,
  busy,
  assets,
  existingAssetIds,
  onOpenChange,
  onImport,
  onAdd,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const available = useMemo(
    () => assets.filter((asset) => !existingAssetIds.includes(asset.id)),
    [assets, existingAssetIds],
  );

  useEffect(() => {
    if (open) setSelectedIds([]);
  }, [open]);

  async function add() {
    if (!selectedIds.length) return;
    await onAdd(selectedIds);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-dialog="term-media-picker" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c.addImages}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[360px] rounded-lg border bg-surface-sunken">
          <div className="grid grid-cols-4 gap-2 p-3 sm:grid-cols-5 md:grid-cols-6">
            {available.map((asset) => {
              const selected = selectedIds.includes(asset.id);
              return (
                <button
                  key={asset.id}
                  data-term-media-asset-id={asset.id}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    'relative aspect-[3/4] overflow-hidden rounded-md border-2 border-transparent bg-media-surround-light outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    selected && 'border-selected-border ring-2 ring-ring',
                  )}
                  onClick={() =>
                    setSelectedIds((current) =>
                      current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id],
                    )
                  }
                >
                  <img className="size-full object-contain" src={asset.mediaUrl} alt="" />
                  {selected && (
                    <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-sm border border-selected-border bg-selected text-selected-foreground">
                      <CheckIcon className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
            {!available.length && (
              <div className="col-span-full grid h-48 place-items-center text-sm text-muted-foreground">
                {c.noAvailableImages}
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="items-center sm:justify-between">
          <Button
            data-action="term-media-picker-import"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void onImport()}
          >
            <UploadIcon className="size-4" />
            {c.importLocal}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {c.cancel}
            </Button>
            <Button
              data-action="term-media-picker-add"
              type="button"
              disabled={busy || !selectedIds.length}
              onClick={() => void add()}
            >
              {c.addSelected}
              {selectedIds.length ? ` · ${selectedIds.length}` : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
