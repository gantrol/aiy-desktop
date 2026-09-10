import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ContentAlbumSelect({
  albumId,
  defaultWhenUnassigned = false,
  disabled,
  albums: supplied,
  onChange,
  onError,
}: {
  albumId: string | null;
  defaultWhenUnassigned?: boolean;
  disabled?: boolean;
  albums?: readonly { id: string; title: string }[];
  onChange(id: string | null): Promise<void>;
  onError(reason: unknown): void;
}) {
  const copy = useI18n().messages.desktopPetals.document;
  const [loaded, setLoaded] = useState<readonly { id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (supplied || (!open && !albumId)) return;
    let live = true;
    void window.desktopPetals
      .albums()
      .then((rows) => {
        if (live) setLoaded(rows);
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [open, supplied, onError, albumId]);
  const albums = supplied ?? loaded;
  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={albumId ?? (defaultWhenUnassigned ? '_default' : '_none')}
      disabled={disabled || busy}
      onValueChange={(value) => {
        setBusy(true);
        void onChange(value === '_none' || value === '_default' ? null : value)
          .catch(onError)
          .finally(() => setBusy(false));
      }}
    >
      <SelectTrigger
        className="h-7 w-auto max-w-48 gap-2 rounded-sm border-0 bg-transparent px-1 text-xs text-inherit shadow-none hover:bg-foreground/5 active:bg-foreground/10 focus-visible:ring-1 disabled:bg-transparent disabled:text-inherit disabled:opacity-40 [&_svg]:opacity-50"
        aria-label={copy.album}
      >
        <SelectValue placeholder={copy.album} />
      </SelectTrigger>
      <SelectContent
        side="top"
        align="start"
        collisionPadding={12}
        className="max-h-[min(16rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-24px)]"
      >
        {defaultWhenUnassigned ? (
          <SelectItem value="_default">{copy.defaultAlbum}</SelectItem>
        ) : (
          <SelectItem value="_none">{copy.noAlbum}</SelectItem>
        )}
        {albumId && !albums.some((album) => album.id === albumId) && (
          <SelectItem value={albumId}>{copy.album}</SelectItem>
        )}
        {albums.map((album) => (
          <SelectItem key={album.id} value={album.id}>
            <span className="block truncate" title={album.title}>
              {album.title}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
