import { useEffect, useState } from 'react';
import { Images, Plus, Upload, X, Paperclip } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import type { PinSummary } from '@/shared/contracts/petal-board';

import type { ReferenceChange } from '@/renderer/features/desktop-petals/use-petal-references';
export function PetalReferenceImages({
  note,
  disabled,
  onChange,
}: {
  note: DesktopNote;
  disabled: boolean;
  onChange(input: ReferenceChange): Promise<boolean>;
}) {
  const copy = useI18n().messages.desktopPetals.references;
  if (!note.references.length) return null;
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto px-3 py-1" aria-label={copy.title}>
      {note.references.map((reference) => (
        <div key={reference.assetId} className="relative size-12 shrink-0">
          <img
            src={reference.mediaUrl}
            alt={copy.title}
            className="size-full rounded-sm object-contain"
            loading="lazy"
          />
          <Button
            variant="secondary"
            className="absolute -right-0.5 -top-0.5 size-4 rounded-sm p-0"
            aria-label={copy.remove}
            title={copy.remove}
            disabled={disabled}
            onClick={() => void onChange({ kind: 'remove', assetId: reference.assetId })}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
export function PetalReferenceAdd({
  note,
  disabled,
  onChange,
  onError,
  onAddFiles,
}: {
  note: DesktopNote;
  disabled: boolean;
  onChange(input: ReferenceChange): Promise<boolean>;
  onError(reason: unknown): void;
  onAddFiles?(): void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0);
  const [items, setItems] = useState<PinSummary[]>([]),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void window.desktopPetals
        .references({ kind: 'search', id: note.id, query, offset })
        .then((result) => {
          if (live && Array.isArray(result)) setItems(result);
        })
        .catch((reason) => {
          if (live) onError(reason);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, note.id, query, offset, onError]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <DropdownMenu modal={false}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" disabled={disabled} title={copy.files.add} aria-label={copy.files.add}>
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled={note.references.length >= 100} onSelect={() => void onChange({ kind: 'upload' })}>
            <Upload />
            {copy.references.upload}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={note.references.length >= 100} onSelect={() => setOpen(true)}>
            <Images />
            {copy.references.library}
          </DropdownMenuItem>
          {onAddFiles && (
            <DropdownMenuItem disabled={(note.files?.length ?? 0) >= 100} onSelect={onAddFiles}>
              <Paperclip />
              {copy.files.choose}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="start"
        className="w-60 max-w-[calc(100vw-32px)] p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Input
          className="h-8"
          value={query}
          placeholder={copy.board.search}
          aria-label={copy.board.search}
          maxLength={100}
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
        />
        <div className="my-2 grid max-h-36 grid-cols-3 gap-1 overflow-y-auto" aria-busy={loading}>
          {items.map((item) => (
            <Button
              key={item.source.id}
              variant="ghost"
              className="h-16 p-0"
              title={item.title || copy.board.IMAGE}
              disabled={loading || disabled}
              onClick={() =>
                void onChange({ kind: 'add', assetId: item.source.id }).then((saved) => saved && setOpen(false))
              }
            >
              {item.mediaUrl && (
                <img
                  src={item.mediaUrl}
                  alt={item.title}
                  className="size-full rounded-sm object-contain"
                  loading="lazy"
                />
              )}
            </Button>
          ))}
        </div>
        <div className="flex justify-between">
          <Button
            variant="ghost"
            size="xs"
            disabled={loading || !offset}
            onClick={() => setOffset((value) => Math.max(0, value - 30))}
          >
            {copy.note.back}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={loading || items.length < 30 || offset >= 10000}
            onClick={() => setOffset((value) => Math.min(10000, value + 30))}
          >
            {copy.board.more}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
