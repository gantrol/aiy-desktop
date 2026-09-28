import { useEffect, useState } from 'react';
import { AlbumSelect } from '@/renderer/components/albums/AlbumSelect';
import type { ContentAlbumOption } from '@/shared/content-album-options';
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
  albums?: readonly ContentAlbumOption[];
  onChange(id: string | null): Promise<void>;
  onError(reason: unknown): void;
}) {
  const copy = useI18n().messages.desktopPetals.document;
  const [loaded, setLoaded] = useState<readonly ContentAlbumOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (supplied || (!open && !albumId)) return;
    let live = true;
    setLoading(true);
    void window.desktopPetals
      .albums()
      .then((rows) => {
        if (live) setLoaded(rows);
      })
      .catch((reason) => {
        if (live) onError(reason);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, supplied, onError, albumId]);
  const albums = supplied ?? loaded;
  const unassigned = defaultWhenUnassigned ? copy.defaultAlbum : copy.noAlbum;
  return (
    <AlbumSelect
      options={albums}
      value={albumId}
      ariaLabel={copy.album}
      nullOption={{ kind: defaultWhenUnassigned ? 'default' : 'unassigned', label: unassigned }}
      variant="ghost"
      className="h-7 w-auto min-w-0 max-w-48 shrink gap-1 rounded-sm px-1 text-xs font-normal text-inherit"
      disabled={disabled}
      loading={!supplied && loading}
      onOpenChange={setOpen}
      onValueChange={onChange}
      onError={onError}
    />
  );
}
