import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, StarIcon, Trash2Icon } from 'lucide-react';
import type { AssetDto, TermMediaItemDto } from '@/shared/contracts';
import { PlusIcon } from '@/renderer/icons';
import type { DictionaryMessages } from '@/renderer/i18n/catalog';
import { Button } from '@/renderer/components/ui/button';
import { TermMediaPickerDialog } from '@/renderer/components/dictionary/TermMediaPickerDialog';

interface Props {
  copy: DictionaryMessages;
  items: TermMediaItemDto[];
  availableAssets: AssetDto[];
  busy: boolean;
  disabled: boolean;
  onImport(): Promise<void>;
  onAdd(assetIds: string[]): Promise<void>;
  onSetCover(mediaId: string): Promise<void>;
  onRemove(mediaId: string): Promise<void>;
  onReorder(mediaIds: string[]): Promise<void>;
}

export function TermMediaEditor({
  copy: c,
  items,
  availableAssets,
  busy,
  disabled,
  onImport,
  onAdd,
  onSetCover,
  onRemove,
  onReorder,
}: Props) {
  const [open, setOpen] = useState(false);

  function move(mediaId: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === mediaId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    void onReorder(next.map((item) => item.id));
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {items.map((item, index) => {
          return (
            <div
              key={item.id}
              className="group relative h-40 w-28 overflow-hidden rounded-lg border bg-media-surround-light"
            >
              <img
                data-asset-id={item.asset.id}
                className="size-full object-contain"
                src={item.asset.mediaUrl}
                alt=""
              />
              {item.role === 'COVER' && (
                <span className="absolute top-1.5 left-1.5 rounded bg-overlay px-1.5 py-0.5 text-[10px] font-medium shadow-overlay">
                  {c.cover}
                </span>
              )}
              {!disabled && (
                <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-center gap-1 rounded-md bg-overlay p-1 opacity-0 shadow-overlay transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {item.role !== 'COVER' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title={c.setCover}
                      aria-label={c.setCover}
                      disabled={busy}
                      onClick={() => void onSetCover(item.id)}
                    >
                      <StarIcon className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={c.moveLeft}
                    aria-label={c.moveLeft}
                    disabled={busy || index === 0}
                    onClick={() => move(item.id, -1)}
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={c.moveRight}
                    aria-label={c.moveRight}
                    disabled={busy || index === items.length - 1}
                    onClick={() => move(item.id, 1)}
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={c.removeImage}
                    aria-label={c.removeImage}
                    disabled={busy}
                    onClick={() => void onRemove(item.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {!disabled && (
          <button
            data-action="term-media-add"
            type="button"
            className="grid h-40 w-28 place-items-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            onClick={() => setOpen(true)}
          >
            <span className="grid justify-items-center gap-2 text-xs">
              <PlusIcon className="size-5" />
              {c.addImages}
            </span>
          </button>
        )}
      </div>
      <TermMediaPickerDialog
        copy={c}
        open={open}
        busy={busy}
        assets={availableAssets}
        existingAssetIds={items.map((item) => item.asset.id)}
        onOpenChange={setOpen}
        onImport={async () => {
          await onImport();
          setOpen(false);
        }}
        onAdd={onAdd}
      />
    </>
  );
}
